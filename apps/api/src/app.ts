import type { Db } from "@levra/db";
import type { HealthResponse } from "@levra/shared/api";
import { Hono } from "hono";
import type { ChainReader } from "./chain/reader";
import { ApiHttpError, fromSwapError } from "./errors";
import type { Logger } from "./logger";
import { chainEventStore, type EventStore } from "./positions/events";
import { accountRoutes } from "./routes/accounts";
import { earnRoutes } from "./routes/earn";
import { dbMarketHistory, marketRoutes, type DexMids } from "./routes/markets";
import { latestDexMids } from "@levra/db";
import { createCache } from "./chain/cache";
import { quoteRoutes } from "./routes/quotes";
import { statusRoutes } from "./routes/status";
import { streamRoutes, type StreamOptions } from "./routes/stream";
import { SwapError, type SwapSource } from "@levra/kyber";

export type AppDeps = {
  logger: Logger;
  reader?: ChainReader;
  swap?: SwapSource;
  /** The indexer's copy of router events. Without one, events are read from chain logs (tests on a fork). */
  events?: EventStore;
  stream?: StreamOptions;
  /** Needed by /v1/status (heartbeats and the indexer cursor). */
  db?: Db;
  version?: string;
};

/** DEX mid prices no older than 30 minutes from the depth keeper, cached for 30 seconds. Initial proposal. */
function dexMidsFromDb(db: Db): DexMids {
  const cached = createCache();
  return () => cached("dexMids", 30_000, () => latestDexMids(db, 1_800));
}

export function createApp({ logger, reader, swap, events, stream, db, version = "dev" }: AppDeps) {
  const app = new Hono();

  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    logger.info(
      { method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - started) },
      "request",
    );
  });

  app.get("/v1/health", (c) => c.json({ ok: true } satisfies HealthResponse));

  if (reader) {
    const store = events ?? chainEventStore(reader);
    const mids = db ? dexMidsFromDb(db) : undefined;
    app.route("/", marketRoutes(reader, mids, db ? dbMarketHistory(db) : undefined));
    app.route("/", streamRoutes(reader, logger, stream, mids));
    app.route("/", accountRoutes(reader, store));
    app.route("/", earnRoutes(reader, store));
    if (swap) app.route("/", quoteRoutes(reader, swap, store));
    if (db) app.route("/", statusRoutes(reader, db, version));
  }

  app.notFound(() => {
    throw new ApiHttpError("NOT_FOUND", "No such endpoint");
  });

  app.onError((err, c) => {
    if (err instanceof SwapError) err = fromSwapError(err);
    if (err instanceof ApiHttpError) {
      if (err.status >= 500) logger.warn({ err, cause: err.cause }, err.message);
      return c.json(err.toBody(), err.status);
    }
    logger.error({ err }, "unhandled error");
    return c.json(new ApiHttpError("INTERNAL", "Internal error").toBody(), 500);
  });

  return app;
}
