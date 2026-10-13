import { keeperHeartbeats, syncCursors, type Db } from "@levra/db";
import { KEEPER_HEARTBEAT_LIMIT_S, keeperName, type StatusResponse } from "@levra/shared/api";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { ChainReader } from "../chain/reader";
import { upstream } from "../errors";

/** The indexer's cursor name, kept in step with apps/indexer. */
const ROUTER_CURSOR = "router_events";

/** What the team monitor stores with its heartbeat about the oracle limits (BE-50). */
type MonitorDetails = { oracleLimits?: Record<string, { limitSeconds: number; learning: boolean }> };

export async function buildStatus(reader: ChainReader, db: Db, version: string): Promise<StatusResponse> {
  const [markets, block, beats, cursors] = await Promise.all([
    upstream(reader.markets),
    upstream(reader.latestBlock),
    db.select().from(keeperHeartbeats),
    db.select().from(syncCursors).where(eq(syncCursors.name, ROUTER_CURSOR)),
  ]);

  const byName = new Map(beats.map((b) => [b.name, b]));
  const limits = (byName.get("monitor")?.details as MonitorDetails | null)?.oracleLimits ?? {};
  const oracle = new Map<string, StatusResponse["oracle"][number]>();
  for (const m of markets) {
    if (oracle.has(m.info.symbol)) continue;
    oracle.set(m.info.symbol, {
      symbol: m.info.symbol,
      publishedAt: m.publishedAt,
      // Source quote age, the open-market clock of D-23.
      ageSeconds: Math.max(0, block.time - m.feedUpdatedAt),
      stale: m.oracleStale,
      ageLimitSeconds: limits[m.info.symbol]?.limitSeconds ?? null,
      ageLimitLearning: limits[m.info.symbol]?.learning ?? true,
    });
  }

  const keepers = keeperName.options.map((name) => {
    const beat = byName.get(name);
    const at = beat ? Math.floor(beat.lastBeatAt.getTime() / 1000) : null;
    return { name, lastHeartbeatAt: at, healthy: at !== null && !beat?.lastError && block.time - at <= KEEPER_HEARTBEAT_LIMIT_S[name] };
  });

  const head = Number(block.number);
  const lastBlock = cursors[0] ? Number(cursors[0].lastBlock) : 0;
  return {
    oracle: [...oracle.values()],
    keepers,
    indexer: { lastBlock, chainHead: head, lagBlocks: Math.max(0, head - lastBlock) },
    api: { version },
  };
}

export function statusRoutes(reader: ChainReader, db: Db, version: string) {
  const app = new Hono();
  app.get("/v1/status", async (c) => c.json(await buildStatus(reader, db, version)));
  return app;
}
