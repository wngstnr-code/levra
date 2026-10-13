import { createDb, runMigrations, syncCursors, vaultEvents } from "@levra/db";
import type { Deployment } from "@levra/shared/deployments";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Address } from "viem";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LogSource, RawLog } from "../src/sources/types";
import { VAULT_CURSOR, syncStream, vaultStream } from "../src/sync";
import { toVaultRow, vaultEventsAbi, vaultTopics } from "../src/vault";
import { router, user } from "./fixtures";

const url = process.env.TEST_DATABASE_URL;
const vault: Address = "0x00000000000000000000000000000000000fa017";
const other: Address = "0x0000000000000000000000000000000000000b0b";
let block = 5_000n;

/** An ERC-4626 event as the vault would emit it. */
function vaultLog(name: "Deposit" | "Withdraw", args: Record<string, unknown>): RawLog {
  const event = getAbiItem({ abi: vaultEventsAbi, name }) as { inputs: readonly { name: string; type: string; indexed?: boolean }[] };
  const topics = encodeEventTopics({ abi: vaultEventsAbi, eventName: name, args } as Parameters<typeof encodeEventTopics>[0]);
  const nonIndexed = event.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name]));
  block += 1n;
  return { blockNumber: block, blockTime: 1_791_876_000, logIndex: 0, txHash: `0x${block.toString(16).padStart(64, "0")}`, address: vault, topics: topics as RawLog["topics"], data };
}

const deposit = (assets: bigint, shares: bigint) => vaultLog("Deposit", { sender: other, owner: user, assets, shares });
const withdraw = (assets: bigint, shares: bigint) => vaultLog("Withdraw", { sender: user, receiver: other, owner: user, assets, shares });

describe("vault events", () => {
  it("decodes with the share owner as user, not the sender or receiver", () => {
    expect(toVaultRow(deposit(100n, 99n))).toMatchObject({ name: "Deposit", user: user.toLowerCase(), vault: vault.toLowerCase(), args: { assets: "100", shares: "99" } });
    expect(toVaultRow(withdraw(40n, 39n))).toMatchObject({ name: "Withdraw", user: user.toLowerCase(), args: { receiver: other.toLowerCase() } });
    expect(vaultTopics).toHaveLength(2);
  });

  it("has no stream before the vault is deployed", () => {
    expect(vaultStream({ router, usdcVault: null } as unknown as Deployment)).toBeNull();
    expect(vaultStream({ router, usdcVault: vault } as unknown as Deployment)).toMatchObject({ cursor: VAULT_CURSOR, address: vault });
  });
});

describe.skipIf(!url)("vault events stored (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const deployment = { chainId: 143, block: 5_000, router, riskManager: router, lens: router, markets: [], usdcVault: vault } as unknown as Deployment;

  beforeEach(async () => {
    await runMigrations(url ?? "");
    await db.delete(vaultEvents).where(eq(vaultEvents.vault, vault.toLowerCase()));
    await db.delete(syncCursors).where(eq(syncCursors.name, VAULT_CURSOR));
  });
  afterAll(() => close());

  it("stores deposits and withdrawals once, even when replayed", async () => {
    const logs = [deposit(1_000n, 990n), withdraw(300n, 297n)];
    const source: LogSource = {
      name: "rpc",
      head: async () => block,
      logs: async (q) => ({ logs: logs.filter((l) => l.blockNumber >= q.fromBlock && l.blockNumber <= q.toBlock), nextBlock: q.toBlock + 1n }),
    };
    const stream = vaultStream(deployment)!;

    expect((await syncStream(db, source, deployment, stream)).inserted).toBe(2);
    const rows = await db.select().from(vaultEvents).where(eq(vaultEvents.vault, vault.toLowerCase())).orderBy(vaultEvents.blockNumber);
    expect(rows.map((r) => [r.name, r.user, r.args.assets])).toEqual([
      ["Deposit", user.toLowerCase(), "1000"],
      ["Withdraw", user.toLowerCase(), "300"],
    ]);

    await db.delete(syncCursors).where(eq(syncCursors.name, VAULT_CURSOR));
    expect((await syncStream(db, source, deployment, stream)).inserted).toBe(0);
  });
});
