import { createDb, deposits, runMigrations } from "@levra/db";
import { IntentsError, type IntentsQuoteRequest, type IntentsSource, type IntentsToken } from "@levra/intents";
import { depositQuoteResponse, depositStatus, depositTokensResponse, withdrawQuoteResponse } from "@levra/shared/api";
import { eq, inArray } from "drizzle-orm";
import pino from "pino";
import { getAddress } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const url = process.env.TEST_DATABASE_URL;
const user = getAddress("0x00000000000000000000000000000000000d3905");
const tokens: IntentsToken[] = [
  { assetId: "monad-usdc", blockchain: "monad", symbol: "USDC", decimals: 6, price: 1, contractAddress: "0x754704bc059f8c67012fed69bc8a327a5aafb603" },
  { assetId: "monad-mon", blockchain: "monad", symbol: "MON", decimals: 18, price: 0.025, contractAddress: null },
  { assetId: "base-usdc", blockchain: "base", symbol: "USDC", decimals: 6, price: 0.9998, contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  { assetId: "sol-sol", blockchain: "sol", symbol: "SOL", decimals: 9, price: null, contractAddress: null },
];

/** A stand-in for 1Click that records the quotes asked for and lets the test set each address's status. */
function fakeIntents() {
  const asked: IntentsQuoteRequest[] = [];
  const statuses = new Map<string, string>();
  let statusReads = 0;
  let n = 0;
  const source: IntentsSource = {
    tokens: async () => tokens,
    quote: async (req) => {
      asked.push(req);
      n += 1;
      if (req.amount < 1_000n) throw new IntentsError("BAD_REQUEST", "Amount is too low for bridge");
      return { depositAddress: `0x${String(n).padStart(40, "0")}`, depositMemo: null, amountIn: req.amount, amountOut: (req.amount * 998n) / 1000n, minAmountOut: 0n, estimatedSeconds: 40, expiresAt: 1_900_000_000, raw: { fake: true } };
    },
    status: async (address) => {
      statusReads += 1;
      const s = statuses.get(address) ?? "PENDING_DEPOSIT";
      return { status: s === "SUCCESS" ? "SUCCESS" : "WAITING", upstreamStatus: s, originTxHash: s === "SUCCESS" ? "0xorigin" : null, destinationTxHash: s === "SUCCESS" ? "0xdest" : null, amountOut: s === "SUCCESS" ? 4_990_000n : null, updatedAt: 0 };
    },
  };
  return { source, asked, statuses, reads: () => statusReads };
}

describe.skipIf(!url)("cross-chain deposits and withdrawals (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const fake = fakeIntents();
  const app = createApp({ logger: pino({ level: "silent" }), db, intents: fake.source });
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(deposits).where(eq(deposits.user, user.toLowerCase()));
  });
  afterAll(() => close());

  it("lists the tokens of other chains with readable chain names", async () => {
    const list = depositTokensResponse.parse(await (await app.request("/v1/deposit/tokens")).json()).tokens;
    expect(list.map((t) => [t.chain, t.chainName, t.symbol])).toEqual([
      ["base", "Base", "USDC"],
      ["sol", "Solana", "SOL"],
    ]);
  });

  it("quotes a deposit into USDC on Monad with a second small transfer for MON, and stores both", async () => {
    const res = await post("/v1/deposit/quote", { recipient: user, originChain: "base", originToken: "base-usdc", amountRaw: "5000000", refundAddress: user, includeGas: true });
    expect(res.status).toBe(200);
    const q = depositQuoteResponse.parse(await res.json());
    expect(q.amountOutRaw).toBe("4990000");
    // About $1 of USDC at $0.9998, rounded up, arriving as MON.
    expect(q.gasDeposit?.amountInRaw).toBe("1000201");
    expect(q.gasOutRaw).toBe(((1_000_201n * 998n) / 1000n).toString());
    expect(fake.asked.map((a) => a.destinationAsset)).toEqual(["monad-usdc", "monad-mon"]);
    expect(fake.asked.every((a) => a.recipient === user && a.refundTo === user && a.slippageBps === 100)).toBe(true);

    const rows = await db.select().from(deposits).where(inArray(deposits.id, [q.id, q.gasDeposit!.id]));
    expect(rows.map((r) => [r.kind, r.status, r.depositAddress]).sort()).toEqual(
      [
        ["deposit", "WAITING", q.depositAddress],
        ["gas", "WAITING", q.gasDeposit!.depositAddress],
      ].sort(),
    );
  });

  it("refuses a token on another chain, a zero amount, and passes on the service's reason", async () => {
    const body = { recipient: user, originChain: "sol", originToken: "base-usdc", amountRaw: "5000000", refundAddress: user, includeGas: false };
    expect((await post("/v1/deposit/quote", body)).status).toBe(400);
    expect((await post("/v1/deposit/quote", { ...body, originChain: "base", amountRaw: "0" })).status).toBe(400);
    const low = await post("/v1/deposit/quote", { ...body, originChain: "base", amountRaw: "10" });
    expect(low.status).toBe(400);
    expect(((await low.json()) as { error: { message: string } }).error.message).toContain("Amount is too low");
    // No price, so the gas top-up cannot be sized.
    expect((await post("/v1/deposit/quote", { ...body, originChain: "sol", originToken: "sol-sol", includeGas: true })).status).toBe(400);
  });

  it("quotes a withdrawal from USDC on Monad with the refund going back to the user's wallet", async () => {
    const res = await post("/v1/withdraw/quote", { user, destinationChain: "base", destinationToken: "base-usdc", amountRaw: "2000000", recipient: "0x00000000000000000000000000000000000ba5e0" });
    expect(res.status).toBe(200);
    const q = withdrawQuoteResponse.parse(await res.json());
    expect(fake.asked.at(-1)).toMatchObject({ originAsset: "monad-usdc", destinationAsset: "base-usdc", refundTo: user });
    const [row] = await db.select().from(deposits).where(eq(deposits.id, q.id));
    expect(row).toMatchObject({ kind: "withdraw", user: user.toLowerCase(), status: "WAITING" });
  });

  it("refreshes a status from the service at most every 10 seconds and stops once it is final", async () => {
    const q = depositQuoteResponse.parse(await (await post("/v1/deposit/quote", { recipient: user, originChain: "base", originToken: "base-usdc", amountRaw: "3000000", refundAddress: user, includeGas: false })).json());
    const read = async () => depositStatus.parse(await (await app.request(`/v1/deposit/${q.id}`)).json());
    const before = fake.reads();
    expect((await read()).status).toBe("WAITING");
    expect((await read()).status).toBe("WAITING");
    expect(fake.reads() - before).toBe(1);

    fake.statuses.set(q.depositAddress, "SUCCESS");
    await db.update(deposits).set({ checkedAt: new Date(Date.now() - 60_000) }).where(eq(deposits.id, q.id));
    expect(await read()).toMatchObject({ status: "SUCCESS", originTxHash: "0xorigin", destinationTxHash: "0xdest", amountOutRaw: "4990000" });
    await read();
    expect(fake.reads() - before).toBe(2);
    expect((await app.request("/v1/deposit/unknown")).status).toBe(404);
  });
});
