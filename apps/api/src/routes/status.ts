import { keeperHeartbeats, syncCursors, type Db } from "@levra/db";
import { chains } from "@levra/shared/chains";
import { KEEPER_HEARTBEAT_LIMIT_S, keeperName, type ChainStatus, type KeeperName, type StatusResponse } from "@levra/shared/api";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { ChainReader } from "../chain/reader";
import { upstream } from "../errors";
import { renderStatusPage, renderStatusUnavailable } from "../status-page";

/** The indexer's cursor name, kept in step with apps/indexer. */
const ROUTER_CURSOR = "router_events";

/** What the team monitor stores with its heartbeat about the oracle limits (BE-50). */
type MonitorDetails = { oracleLimits?: Record<string, { limitSeconds: number; learning: boolean }> };

type Beat = typeof keeperHeartbeats.$inferSelect;

async function chainParts(reader: ChainReader, db: Db) {
  const chainId = reader.deployment.chainId;
  const [block, beats, cursors] = await Promise.all([
    upstream(reader.latestBlock),
    db.select().from(keeperHeartbeats).where(eq(keeperHeartbeats.chainId, chainId)),
    db.select().from(syncCursors).where(and(eq(syncCursors.chainId, chainId), eq(syncCursors.name, ROUTER_CURSOR))),
  ]);
  const byName = new Map(beats.map((b) => [b.name, b]));
  const keeper = (name: KeeperName, beat: Beat | undefined) => {
    const at = beat ? Math.floor(beat.lastBeatAt.getTime() / 1000) : null;
    return { name, lastHeartbeatAt: at, healthy: at !== null && !beat?.lastError && block.time - at <= KEEPER_HEARTBEAT_LIMIT_S[name] };
  };
  const head = Number(block.number);
  const lastBlock = cursors[0] ? Number(cursors[0].lastBlock) : 0;
  return {
    block,
    byName,
    /** Every keeper job, reported or not: the shape of the top-level list. */
    allKeepers: keeperName.options.map((name) => keeper(name, byName.get(name))),
    /** Only the jobs that have reported on this chain; the others do not run there yet. */
    reportedKeepers: keeperName.options.filter((name) => byName.has(name)).map((name) => keeper(name, byName.get(name))),
    indexer: { lastBlock, chainHead: head, lagBlocks: Math.max(0, head - lastBlock) },
  };
}

/** `readers` holds the main chain (Monad) first, then every other chain the API has a deployment for. */
export async function buildStatus(readers: ChainReader[], db: Db, version: string): Promise<StatusResponse> {
  const [main, ...others] = readers;
  if (!main) throw new Error("buildStatus needs at least one chain");
  const [markets, mainParts, otherParts] = await Promise.all([
    upstream(main.markets),
    chainParts(main, db),
    Promise.all(others.map((r) => chainParts(r, db))),
  ]);

  const limits = (mainParts.byName.get("monitor")?.details as MonitorDetails | null)?.oracleLimits ?? {};
  const oracle = new Map<string, StatusResponse["oracle"][number]>();
  for (const m of markets) {
    if (oracle.has(m.info.symbol)) continue;
    oracle.set(m.info.symbol, {
      symbol: m.info.symbol,
      publishedAt: m.publishedAt,
      // Source quote age, the open-market clock of D-23.
      ageSeconds: Math.max(0, mainParts.block.time - m.feedUpdatedAt),
      stale: m.oracleStale,
      ageLimitSeconds: limits[m.info.symbol]?.limitSeconds ?? null,
      ageLimitLearning: limits[m.info.symbol]?.learning ?? true,
    });
  }

  const describe = (reader: ChainReader, parts: Awaited<ReturnType<typeof chainParts>>, keepers: ChainStatus["keepers"]): ChainStatus => {
    const id = reader.deployment.chainId;
    return { chainId: id, name: chains[id as keyof typeof chains]?.name ?? String(id), keepers, indexer: parts.indexer };
  };
  return {
    oracle: [...oracle.values()],
    keepers: mainParts.allKeepers,
    indexer: mainParts.indexer,
    chains: [describe(main, mainParts, mainParts.allKeepers), ...others.map((r, i) => describe(r, otherParts[i]!, otherParts[i]!.reportedKeepers))],
    api: { version },
  };
}

export function statusRoutes(readers: ChainReader[], db: Db, version: string) {
  const app = new Hono();
  app.get("/v1/status", async (c) => c.json(await buildStatus(readers, db, version)));
  // The public status page (BE-61). When the chain cannot be read, the page says so instead of failing.
  app.get("/status", async (c) => {
    c.header("cache-control", "public, max-age=15");
    try {
      return c.html(renderStatusPage(await buildStatus(readers, db, version), Math.floor(Date.now() / 1000)));
    } catch {
      return c.html(renderStatusUnavailable(), 503);
    }
  });
  return app;
}
