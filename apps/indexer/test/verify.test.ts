import { createDb, morphoEvents, routerEvents, runMigrations, syncCursors } from "@levra/db";
import type { Deployment } from "@levra/shared/deployments";
import { and, eq } from "drizzle-orm";
import type { PublicClient } from "viem";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LogSource } from "../src/sources/types";
import { ROUTER_CURSOR, routerStream, syncRouter } from "../src/sync";
import { checkPositions, checkStream, pacedSource, traction } from "../src/verify";
import { marketId, openedLog, router, user } from "./fixtures";

const url = process.env.TEST_DATABASE_URL;
const deployment = { chainId: 143, block: 1_000, router, riskManager: router, lens: router, markets: [{ marketId }] } as unknown as Deployment;

/** Serves the PositionOpened logs at the given blocks, 400 blocks per page. */
const source = (at: bigint[]): LogSource => ({
  name: "rpc",
  head: async () => 2_000n,
  async logs(q) {
    const to = q.fromBlock + 399n < q.toBlock ? q.fromBlock + 399n : q.toBlock;
    return { logs: at.filter((b) => b >= q.fromBlock && b <= to).map((b) => openedLog(b)), nextBlock: to + 1n };
  },
});

describe.skipIf(!url)("data check after a move (BE-91, needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });

  beforeEach(async () => {
    await runMigrations(url ?? "");
    await db.delete(routerEvents);
    await db.delete(morphoEvents).where(eq(morphoEvents.marketId, marketId));
    await db.delete(syncCursors).where(eq(syncCursors.name, ROUTER_CURSOR));
  });
  afterAll(() => close());

  it("calls a fully synced stream complete and names a missing and an extra event", async () => {
    const at = [1_000n, 1_500n, 2_000n];
    await syncRouter(db, source(at), deployment);
    expect(await checkStream(db, source(at), deployment, routerStream(deployment))).toMatchObject({ onChain: 3, inDb: 3, missing: [], extra: [] });

    const lost = openedLog(1_500n);
    await db.delete(routerEvents).where(and(eq(routerEvents.txHash, lost.txHash), eq(routerEvents.logIndex, 0)));
    const afterLoss = await checkStream(db, source(at), deployment, routerStream(deployment));
    expect(afterLoss?.missing).toEqual([`${lost.txHash}:0`]);

    // An event the chain does not have, as a wrong restore would leave.
    const check = await checkStream(db, source([1_000n, 2_000n]), deployment, routerStream(deployment));
    expect(check).toMatchObject({ missing: [], extra: [] });
    const withExtra = await checkStream(db, source([1_000n]), deployment, routerStream(deployment));
    expect(withExtra?.extra).toEqual([`${openedLog(2_000n).txHash}:0`]);
  });

  it("does not judge a stream that never synced, or another chain's rows", async () => {
    expect(await checkStream(db, source([]), deployment, routerStream(deployment))).toBeNull();
    await syncRouter(db, source([1_000n]), { ...deployment, chainId: 8453 });
    expect(await checkStream(db, source([]), deployment, routerStream(deployment))).toBeNull();
  });

  it("counts wallets and events per chain", async () => {
    await syncRouter(db, source([1_000n, 1_500n]), deployment);
    const t = await traction(db, 143);
    expect(t.router).toEqual([{ name: "PositionOpened", events: 2, wallets: 1 }]);
    expect(t.wallets).toBe(1);
    expect((await traction(db, 8453)).wallets).toBe(0);
  });

  it("compares positions rebuilt from Morpho events with Morpho's own", async () => {
    const row = (name: string, args: Record<string, string>, logIndex: number) => ({
      chainId: 143, name, marketId, user, args, blockNumber: 1_000n, blockTime: new Date(), txHash: `0x${"cd".repeat(32)}`, logIndex,
    });
    await db.insert(morphoEvents).values([row("SupplyCollateral", { assets: "500" }, 0), row("Borrow", { shares: "70" }, 1)]);
    const reading = (collateral: bigint, borrowShares: bigint) => ({ multicall: async () => [{ supplyShares: 0n, collateral, borrowShares }] }) as unknown as PublicClient;
    expect(await checkPositions(db, reading(500n, 70n), deployment)).toEqual({ checked: 1, open: 1, mismatches: [] });
    const off = await checkPositions(db, reading(500n, 90n), deployment);
    expect(off.mismatches).toEqual([{ user, marketId, indexed: { collateral: 500n, borrowShares: 70n }, onChain: { collateral: 500n, borrowShares: 90n } }]);
  });

  it("checks closed positions too, so a lost close or a lost reopen shows", async () => {
    const row = (name: string, args: Record<string, string>, logIndex: number) => ({
      chainId: 143, name, marketId, user, args, blockNumber: 1_000n, blockTime: new Date(), txHash: `0x${"ef".repeat(32)}`, logIndex,
    });
    await db.insert(morphoEvents).values([row("SupplyCollateral", { assets: "500" }, 0), row("WithdrawCollateral", { assets: "500" }, 1)]);
    const reading = (collateral: bigint) => ({ multicall: async () => [{ supplyShares: 0n, collateral, borrowShares: 0n }] }) as unknown as PublicClient;
    expect(await checkPositions(db, reading(0n), deployment)).toEqual({ checked: 1, open: 0, mismatches: [] });
    expect((await checkPositions(db, reading(500n), deployment)).mismatches).toHaveLength(1);
  });
});

describe("paced log reads for verify:data", () => {
  it("waits between log queries but not before the first, and keeps the source as it is without a pause", async () => {
    const waits: number[] = [];
    const paced = pacedSource(source([1_000n]), 500, async (ms) => void waits.push(ms));
    await paced.logs({ address: [router], topic0: [], fromBlock: 1_000n, toBlock: 1_399n });
    expect(waits).toEqual([]);
    await paced.logs({ address: [router], topic0: [], fromBlock: 1_400n, toBlock: 1_799n });
    await paced.logs({ address: [router], topic0: [], fromBlock: 1_800n, toBlock: 2_000n });
    expect(waits).toEqual([500, 500]);
    const plain = source([]);
    expect(pacedSource(plain, 0)).toBe(plain);
  });
});