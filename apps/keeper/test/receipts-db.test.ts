import { createDb, receiptKeys, routerEvents, runMigrations, tapesendOutbox } from "@levra/db";
import type { Deployment } from "@levra/shared/deployments";
import { LEVRA_TAPEOUT_XLAYER, decodeContent, deriveReceiptKey, hubAbi, openReceipt, receiptKeyText } from "@levra/tapeout";
import { and, eq, inArray } from "drizzle-orm";
import pino from "pino";
import { encodeAbiParameters, encodeEventTopics, getAddress, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReceipts } from "../src/receipts/job";
import { createTapeSendSender } from "../src/receipts/sender";

const url = process.env.TEST_DATABASE_URL;
const logger = pino({ level: "silent" });
const signal = new AbortController().signal;

const STOCK = "0x00000000000000000000000000000000000057c0" as const;
const USDC = "0x0000000000000000000000000000000000005dc0" as const;
const MARKET: Hex = `0x${"5e".repeat(32)}`;
const deployment = {
  chainId: 196,
  block: 0,
  router: "0x0000000000000000000000000000000000000001",
  riskManager: "0x0000000000000000000000000000000000000002",
  lens: "0x0000000000000000000000000000000000000003",
  markets: [{ symbol: "NVDA", side: "long", marketId: MARKET, oracle: "0x0000000000000000000000000000000000000004", collateralToken: STOCK, loanToken: USDC, lltv: "625000000000000000" }],
} as Deployment;

describe.skipIf(!url)("receipts queue and TapeSend sender (BE-84, needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const holder = privateKeyToAccount(generatePrivateKey());
  const late = privateKeyToAccount(generatePrivateKey());
  const nokey = privateKeyToAccount(generatePrivateKey());
  const users = [holder, late, nokey].map((a) => a.address.toLowerCase());
  let secretKey: Uint8Array;

  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
  let log = 0;
  const event = (user: string, name: string, minutesAgo: number, args: Record<string, string | number>) => ({
    chainId: 196,
    name,
    user,
    marketId: MARKET,
    args,
    blockNumber: BigInt(1_000 + log),
    blockTime: at(minutesAgo),
    // Unique per run: the wallets are new each run and the hashes start with them.
    txHash: `0x${users[0]!.slice(2, 26)}${(++log).toString(16).padStart(40, "0")}`,
    logIndex: 0,
    router: deployment.router.toLowerCase(),
  });
  const opened = (user: string, m: number) => event(user, "PositionOpened", m, { margin: "100000000", collateralDelta: "2000000000000000000", debtDelta: "200000000", fee: "0", execPriceE8: "15000000000" });
  const closed = (user: string, m: number) => event(user, "PositionReduced", m, { collateralDelta: "2000000000000000000", debtDelta: "0", returned: "120000000", fee: "0", reason: 0, execPriceE8: "18000000000" });

  const decimalsClient = { readContract: async ({ address }: { address: string }) => (address === STOCK ? 18 : 6) } as never;

  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(receiptKeys).where(inArray(receiptKeys.address, users));
    await db.delete(tapesendOutbox).where(inArray(tapesendOutbox.address, users));
    await db.delete(routerEvents).where(and(eq(routerEvents.chainId, 196), inArray(routerEvents.user, users)));
    const input = { wallet: holder.address, hub: LEVRA_TAPEOUT_XLAYER.hub, chainId: 196 };
    const key = deriveReceiptKey({ ...input, signature: await holder.signMessage({ message: receiptKeyText(input) }) });
    secretKey = key.secretKey;
    await db.insert(receiptKeys).values([
      { address: users[0]!, publicKey: toHex(key.publicKey), keyIndex: 0, createdAt: at(60), updatedAt: at(60) },
      // Registered after its close: no receipt for that close.
      { address: users[1]!, publicKey: toHex(key.publicKey), keyIndex: 0, createdAt: at(1), updatedAt: at(1) },
    ]);
    await db.insert(routerEvents).values([opened(users[0]!, 50), closed(users[0]!, 40), opened(users[1]!, 30), closed(users[1]!, 20), opened(users[2]!, 30), closed(users[2]!, 20)]);
  });
  afterAll(() => close());

  it("queues one receipt per close of a wallet with a key, from when the key was registered", async () => {
    const job = createReceipts({ client: decimalsClient, deployment });
    expect(await job.run({ db, chainId: 196, logger, signal })).toMatchObject({ queued: 1 });
    expect(await job.run({ db, chainId: 196, logger, signal })).toMatchObject({ queued: 0 });
    const rows = await db.select().from(tapesendOutbox).where(inArray(tapesendOutbox.address, users));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ address: users[0], subject: "NVDA long closed: +20.00%", sentAt: null, txHash: null });
    expect(rows[0]!.body).toContain("Entry: $150\nExit: $180\nProfit or loss: $20.00 (+20.00% of the margin)");
  });

  it("sends each message once, parks one without a key, retries a failed send, and never starts a second transaction while one is out", async () => {
    await db.insert(tapesendOutbox).values({ address: users[2]!, key: "196:close:none:0", subject: "s", body: "b", levra: {}, eventAt: new Date(), createdAt: new Date() });
    const sender = getAddress(LEVRA_TAPEOUT_XLAYER.sender);
    const receipts = new Map<Hex, unknown>();
    const known = new Set<Hex>();
    let inbox = 4n;
    let fail = false;
    let mine = true;
    const sends: unknown[][] = [];
    const sentLog = (to: Hex, payload: Hex) => ({
      address: LEVRA_TAPEOUT_XLAYER.hub,
      topics: encodeEventTopics({ abi: hubAbi, eventName: "Sent", args: { to, from: LEVRA_TAPEOUT_XLAYER.container, ref: `0x${"0".repeat(64)}` } }),
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }], [++inbox, inbox, payload]),
      blockNumber: 1n, logIndex: 0, transactionIndex: 0, transactionHash: `0x${"0".repeat(64)}`, blockHash: `0x${"0".repeat(64)}`, removed: false,
    });
    const client = {
      readContract: async () => sender,
      getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        if (!receipts.has(hash)) throw new Error("not found");
        return receipts.get(hash);
      },
      getTransaction: async ({ hash }: { hash: Hex }) => {
        if (!known.has(hash)) throw new Error("not found");
        return { hash };
      },
      waitForTransactionReceipt: async () => null,
    } as never;
    const wallet = {
      account: { address: sender },
      chain: undefined,
      writeContract: async ({ args }: { args: readonly unknown[] }) => {
        if (fail) throw new Error("estimateGas failed");
        sends.push([...args]);
        const hash = `0x${sends.length.toString(16).padStart(64, "a")}` as Hex;
        known.add(hash);
        if (mine) receipts.set(hash, { status: "success", logs: [sentLog(args[2] as Hex, args[4] as Hex)] });
        return hash;
      },
    } as never;
    let clock = Date.now();
    const job = createTapeSendSender({ client, wallet, now: () => clock });
    const run = () => job.run({ db, chainId: 196, logger, signal });
    const row = async (address: string) => (await db.select().from(tapesendOutbox).where(eq(tapesendOutbox.address, address)))[0]!;

    expect(await run()).toMatchObject({ sent: 1, pending: 0 });
    const sent = await row(users[0]!);
    expect(sent).toMatchObject({ inboxIndex: "5", attempts: 1, lastError: null });
    expect(sent.sentAt).not.toBeNull();
    expect(sends[0]![0]).toBe(LEVRA_TAPEOUT_XLAYER.circuits);
    expect(sends[0]![1]).toBe(LEVRA_TAPEOUT_XLAYER.clockCircuitId);
    // The wallet opens what was sent with the key from its signature.
    const opened = decodeContent(openReceipt(holder.address, secretKey, sent.payload as Hex).content);
    expect(opened.subject).toBe("NVDA long closed: +20.00%");
    expect(await row(users[2]!)).toMatchObject({ attempts: 5, lastError: "the wallet has no receipt key", txHash: null });

    // A failed send is kept with its error and tried again on the next run.
    await db.insert(tapesendOutbox).values({ address: users[0]!, key: "alert:x:1", subject: "a", body: "b", levra: {}, eventAt: new Date(), createdAt: new Date() });
    fail = true;
    expect(await run()).toMatchObject({ sent: 0 });
    const failed = (await db.select().from(tapesendOutbox).where(eq(tapesendOutbox.key, "alert:x:1")))[0]!;
    expect(failed).toMatchObject({ attempts: 1, txHash: null, lastError: "estimateGas failed" });

    // Out but not mined: the next run waits and sends nothing new.
    fail = false;
    mine = false;
    expect(await run()).toMatchObject({ pending: 1 });
    const out = (await db.select().from(tapesendOutbox).where(eq(tapesendOutbox.key, "alert:x:1")))[0]!;
    expect(out.txHash).not.toBeNull();
    await db.insert(tapesendOutbox).values({ address: users[0]!, key: "alert:y:1", subject: "a", body: "b", levra: {}, eventAt: new Date(), createdAt: new Date() });
    const before = sends.length;
    expect(await run()).toMatchObject({ pending: 1 });
    expect(sends.length).toBe(before);

    // Forgotten by the node for ten minutes: dropped, sent again, then the queue moves on.
    known.clear();
    clock += 11 * 60_000;
    mine = true;
    expect(await run()).toMatchObject({ sent: 2, pending: 0 });
    const done = await db.select().from(tapesendOutbox).where(inArray(tapesendOutbox.key, ["alert:x:1", "alert:y:1"]));
    expect(done.every((r) => r.sentAt !== null)).toBe(true);
    expect(done.find((r) => r.key === "alert:x:1")!.attempts).toBe(3);
  });
});
