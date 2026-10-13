import { keeperHeartbeats, syncCursors, type Db } from "@levra/db";
import { keeperName, type KeeperName, type StatusResponse } from "@levra/shared/api";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { ChainReader } from "../chain/reader";
import { upstream } from "../errors";

/** The indexer's cursor name, kept in step with apps/indexer. */
const ROUTER_CURSOR = "router_events";

/**
 * A keeper is healthy when its last heartbeat is newer than this and carries no error. Initial proposal (08 says "a few
 * minutes"); the oracle age poster runs hourly, so it gets two hours.
 */
const HEARTBEAT_LIMIT_S: Record<KeeperName, number> = {
  calendar: 300,
  protector: 300,
  liquidator: 300,
  alerts: 300,
  oracleMonitor: 300,
  oracleAgePoster: 7_200,
};

export async function buildStatus(reader: ChainReader, db: Db, version: string): Promise<StatusResponse> {
  const [markets, block, beats, cursors] = await Promise.all([
    upstream(reader.markets),
    upstream(reader.latestBlock),
    db.select().from(keeperHeartbeats),
    db.select().from(syncCursors).where(eq(syncCursors.name, ROUTER_CURSOR)),
  ]);

  const oracle = new Map<string, StatusResponse["oracle"][number]>();
  for (const m of markets) {
    if (oracle.has(m.info.symbol)) continue;
    oracle.set(m.info.symbol, {
      symbol: m.info.symbol,
      publishedAt: m.publishedAt,
      // Source quote age, the open-market clock of D-23.
      ageSeconds: Math.max(0, block.time - m.feedUpdatedAt),
      stale: m.oracleStale,
    });
  }

  const byName = new Map(beats.map((b) => [b.name, b]));
  const keepers = keeperName.options.map((name) => {
    const beat = byName.get(name);
    const at = beat ? Math.floor(beat.lastBeatAt.getTime() / 1000) : null;
    return { name, lastHeartbeatAt: at, healthy: at !== null && !beat?.lastError && block.time - at <= HEARTBEAT_LIMIT_S[name] };
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
