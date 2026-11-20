import { createDb, routerEvents, runMigrations, syncCursors } from "@levra/db";
import type { Deployment } from "@levra/shared/deployments";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LogQuery, LogSource } from "../src/sources/types";
import { ROUTER_CURSOR, syncRouter } from "../src/sync";
import { openedLog, router } from "./fixtures";

const url = process.env.TEST_DATABASE_URL;

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
    await db.delete(syncCursors).where(eq(syncCursors.name, ROUTER_CURSOR));
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

  it("stops when a source makes no progress instead of looping", async () => {
    const stuck: LogSource = { name: "hypersync", head: async () => 5_000n, logs: async (q) => ({ logs: [], nextBlock: q.fromBlock }) };
    expect(await syncRouter(db, stuck, deployment)).toMatchObject({ lastBlock: 999n, inserted: 0 });
  });
});
