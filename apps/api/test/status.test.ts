import { createDb, keeperHeartbeats, runMigrations, syncCursors } from "@levra/db";
import { statusResponse } from "@levra/shared/api";
import { stocks } from "@levra/shared/markets";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChainReader, MarketState } from "../src/chain/reader";
import { buildStatus } from "../src/routes/status";

const url = process.env.TEST_DATABASE_URL;
const NOW = 1_791_880_000;

function market(symbol: "QQQ" | "BIL", side: "long" | "short", feedUpdatedAt: number, stale = false) {
  return {
    info: { symbol, side, stock: stocks[symbol] },
    publishedAt: feedUpdatedAt + 600,
    feedUpdatedAt,
    oracleStale: stale,
  } as unknown as MarketState;
}

const reader = {
  deployment: { chainId: 143 },
  markets: async () => [market("QQQ", "long", NOW - 1_500), market("QQQ", "short", NOW - 1_500), market("BIL", "long", NOW - 5_000, true)],
  latestBlock: async () => ({ number: 2_000n, time: NOW }),
} as unknown as ChainReader;

const baseReader = {
  deployment: { chainId: 8453 },
  markets: async () => [],
  latestBlock: async () => ({ number: 5_000n, time: NOW }),
} as unknown as ChainReader;

describe.skipIf(!url)("status (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });

  beforeAll(async () => {
    await runMigrations(url ?? "");
    // Keeper tests use oracleMonitor and calendar; this test only touches names they leave alone.
    await db.delete(syncCursors).where(eq(syncCursors.name, "router_events"));
    await db.delete(keeperHeartbeats).where(eq(keeperHeartbeats.chainId, 8453));
    await db.insert(keeperHeartbeats).values([
      { chainId: 143, name: "alerts", lastBeatAt: new Date((NOW - 30) * 1000), lastError: null },
      { chainId: 143, name: "protector", lastBeatAt: new Date((NOW - 30) * 1000), lastError: "rpc down" },
      { chainId: 143, name: "liquidator", lastBeatAt: new Date((NOW - 900) * 1000), lastError: null },
    ]).onConflictDoUpdate({ target: [keeperHeartbeats.chainId, keeperHeartbeats.name], set: { lastBeatAt: sql`excluded.last_beat_at`, lastError: sql`excluded.last_error` } });
    await db.delete(keeperHeartbeats).where(eq(keeperHeartbeats.name, "oracleAgePoster"));
    // The team monitor learned a QQQ limit from data and is still learning BIL.
    const limits = { QQQ: { limitSeconds: 1_620, learning: false }, BIL: { limitSeconds: 2_100, learning: true } };
    await db.insert(keeperHeartbeats).values({ chainId: 143, name: "monitor", lastBeatAt: new Date((NOW - 30) * 1000), lastError: null, details: { oracleLimits: limits } }).onConflictDoUpdate({ target: [keeperHeartbeats.chainId, keeperHeartbeats.name], set: { lastBeatAt: sql`excluded.last_beat_at`, details: sql`excluded.details` } });
    await db.insert(syncCursors).values({ chainId: 143, name: "router_events", lastBlock: 1_990n, updatedAt: new Date() });
    // Base: only the team monitor runs there so far, and its indexer is further behind.
    await db.insert(keeperHeartbeats).values({ chainId: 8453, name: "monitor", lastBeatAt: new Date((NOW - 30) * 1000), lastError: null });
    await db.insert(syncCursors).values({ chainId: 8453, name: "router_events", lastBlock: 4_000n, updatedAt: new Date() });
  });
  afterAll(async () => {
    await db.delete(keeperHeartbeats).where(eq(keeperHeartbeats.name, "monitor"));
    await db.delete(syncCursors).where(eq(syncCursors.chainId, 8453));
    await close();
  });

  it("reports oracle age per stock, keeper health and indexer lag", async () => {
    const s = statusResponse.parse(await buildStatus([reader], db, "abc123"));
    expect(s.oracle).toEqual([
      { symbol: "QQQ", publishedAt: NOW - 900, ageSeconds: 1_500, stale: false, ageLimitSeconds: 1_620, ageLimitLearning: false },
      { symbol: "BIL", publishedAt: NOW - 4_400, ageSeconds: 5_000, stale: true, ageLimitSeconds: 2_100, ageLimitLearning: true },
    ]);
    const health = Object.fromEntries(s.keepers.map((k) => [k.name, k.healthy]));
    expect(health).toMatchObject({ alerts: true, protector: false, liquidator: false, oracleAgePoster: false });
    expect(s.keepers.find((k) => k.name === "oracleAgePoster")?.lastHeartbeatAt).toBeNull();
    expect(s.indexer).toEqual({ lastBlock: 1_990, chainHead: 2_000, lagBlocks: 10 });
    expect(s.api.version).toBe("abc123");
  });

  it("adds every chain, Monad first, with only the keepers that report on the other chains", async () => {
    const s = statusResponse.parse(await buildStatus([reader, baseReader], db, "abc123"));
    expect(s.chains?.map((c) => [c.chainId, c.name])).toEqual([
      [143, "Monad"],
      [8453, "Base"],
    ]);
    expect(s.chains?.[0]?.keepers).toEqual(s.keepers);
    expect(s.chains?.[1]).toMatchObject({ keepers: [{ name: "monitor", healthy: true }], indexer: { lastBlock: 4_000, chainHead: 5_000, lagBlocks: 1_000 } });
    // The top level stays Monad, so older clients read the same values.
    expect(s.indexer).toEqual({ lastBlock: 1_990, chainHead: 2_000, lagBlocks: 10 });
  });
});
