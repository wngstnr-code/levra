import { createDb, protectedPositions, routerCursor, routerEvents, runMigrations, syncCursors } from "@levra/db";
import type { Deployment } from "@levra/shared/deployments";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LogQuery, LogSource } from "../src/sources/types";
import { syncRouter } from "../src/sync";
import { marketId, openedLog, router } from "./fixtures";

const url = process.env.TEST_DATABASE_URL;
const ROUTER_CURSOR = "router_events";
const NEW_ROUTER = "0x00000000000000000000000000000000000e0002" as const;

const deployment = { chainId: 143, block: 1_000, router, riskManager: router, lens: router, markets: [] } as unknown as Deployment;

/** Serves logs at the given blocks, at most `pageSize` blocks per call. */
function fakeSource(head: bigint, at: bigint[], pageSize = 400n) {
  const queries: LogQuery[] = [];
  const source: LogSource = {
    name: "rpc",
    head: async () => head,
    async logs(q) {
      queries.push(q);
      const to = q.fromBlock + pageSize - 1n < q.toBlock ? q.fromBlock + pageSize - 1n : q.toBlock;
      return { logs: at.filter((b) => b >= q.fromBlock && b <= to).map((b) => openedLog(b)), nextBlock: to + 1n };
    },
  };
  return { source, queries };
}

describe.skipIf(!url)("router sync (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });

  beforeEach(async () => {
    await runMigrations(url ?? "");
    await db.delete(routerEvents);
    await db.delete(syncCursors).where(like(syncCursors.name, "router_events%"));
  });
  afterAll(() => close());

  it("starts at the deployment block, follows pages to the head and keeps a cursor", async () => {
    const { source, queries } = fakeSource(2_000n, [1_000n, 1_500n, 2_000n]);
    const result = await syncRouter(db, source, deployment);
    expect(queries[0]?.fromBlock).toBe(1_000n);
    expect(result).toMatchObject({ lastBlock: 2_000n, inserted: 3 });
    const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.name, ROUTER_CURSOR));
    expect(cursor).toMatchObject({ name: ROUTER_CURSOR, lastBlock: 2_000n });
  });

  it("gives the same rows when replayed from the start", async () => {
    const { source } = fakeSource(2_000n, [1_000n, 1_500n, 2_000n]);
    await syncRouter(db, source, deployment);
    const first = await db.select().from(routerEvents);
    await db.delete(syncCursors).where(eq(syncCursors.name, ROUTER_CURSOR));
    const again = await syncRouter(db, source, deployment);
    expect(again.inserted).toBe(0);
    expect(await db.select().from(routerEvents)).toEqual(first);
  });

  it("keeps each chain's rows and cursor apart, even for the same transaction hash", async () => {
    const { source } = fakeSource(2_000n, [1_000n, 1_500n]);
    await syncRouter(db, source, deployment);
    const onBase = { ...deployment, chainId: 8453 } as Deployment;
    const again = await syncRouter(db, fakeSource(2_000n, [1_000n, 1_500n]).source, onBase);
    expect(again.inserted).toBe(2);
    const rows = await db.select().from(routerEvents);
    expect(rows.filter((r) => r.chainId === 143)).toHaveLength(2);
    expect(rows.filter((r) => r.chainId === 8453)).toHaveLength(2);
    const cursors = await db.select().from(syncCursors).where(eq(syncCursors.name, ROUTER_CURSOR));
    expect(cursors.map((c) => c.chainId).sort()).toEqual([143, 8453]);
  });

  it("records the router of each event (BE-100)", async () => {
    await syncRouter(db, fakeSource(2_000n, [1_000n]).source, deployment);
    expect((await db.select().from(routerEvents)).map((r) => r.router)).toEqual([router]);
  });

  it("after a router change reads both routers again from the deployment block, keeping each event's router (BE-100)", async () => {
    // Indexed before BE-100: the old router's rows have no router yet.
    await syncRouter(db, fakeSource(2_000n, [1_000n, 1_500n]).source, deployment);
    await db.update(routerEvents).set({ router: null });

    const queries: LogQuery[] = [];
    const both: LogSource = {
      name: "rpc",
      head: async () => 3_000n,
      async logs(q) {
        queries.push(q);
        const old = [1_000n, 1_500n].filter((b) => b >= q.fromBlock && b <= q.toBlock).map((b) => openedLog(b));
        // The new router went live at block 1_800, before the indexer got the new deployment file.
        const fresh = [1_900n, 2_500n].filter((b) => b >= q.fromBlock && b <= q.toBlock).map((b) => ({ ...openedLog(b, 1), address: NEW_ROUTER }));
        return { logs: [...old, ...fresh], nextBlock: q.toBlock + 1n };
      },
    };
    const changed = { ...deployment, router: NEW_ROUTER, previousRouters: [router] } as Deployment;
    const result = await syncRouter(db, both, changed);

    expect(queries[0]).toMatchObject({ fromBlock: 1_000n, address: [NEW_ROUTER, router] });
    expect(result).toMatchObject({ lastBlock: 3_000n });
    const rows = (await db.select().from(routerEvents)).map((r) => [Number(r.blockNumber), r.router]).sort((a, b) => Number(a[0]) - Number(b[0]));
    expect(rows).toEqual([
      [1_000, router],
      [1_500, router],
      [1_900, NEW_ROUTER],
      [2_500, NEW_ROUTER],
    ]);
    expect(routerCursor(changed)).toBe("router_events:2");
    const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.name, "router_events:2"));
    expect(cursor?.lastBlock).toBe(3_000n);
  });

  it("finds protected positions only on the current router, since opt-in does not move (BE-100)", async () => {
    const at = new Date();
    const protection = (u: string, enabled: boolean, block: number, r: string | null) => ({
      chainId: 143,
      name: "ProtectionSet",
      user: u,
      marketId,
      args: { user: u, marketId, enabled },
      blockNumber: BigInt(block),
      blockTime: at,
      txHash: `0x${block.toString(16).padStart(64, "0")}`,
      logIndex: 0,
      router: r,
    });
    const [onOld, onNew, legacy] = ["0x00000000000000000000000000000000000a0001", "0x00000000000000000000000000000000000a0002", "0x00000000000000000000000000000000000a0003"];
    await db.insert(routerEvents).values([protection(onOld, true, 1_100, router), protection(onNew, true, 2_100, NEW_ROUTER), protection(legacy, true, 1_200, null)]);

    const users = async (r: { address: string; hasPrevious: boolean }) => (await protectedPositions(db, 143, r)).map((p) => p.user).sort();
    // After the change: only the opt-in made on the new router counts.
    expect(await users({ address: NEW_ROUTER, hasPrevious: true })).toEqual([onNew]);
    // Before any change, rows indexed without a router come from the only router there is.
    expect(await users({ address: router, hasPrevious: false })).toEqual([onOld, legacy]);
  });

  it("stops when a source makes no progress instead of looping", async () => {
    const stuck: LogSource = { name: "hypersync", head: async () => 5_000n, logs: async (q) => ({ logs: [], nextBlock: q.fromBlock }) };
    expect(await syncRouter(db, stuck, deployment)).toMatchObject({ lastBlock: 999n, inserted: 0 });
  });
});
