import type { HealthResponse } from "@levra/shared/api";
import { Hono } from "hono";
import type { ChainReader } from "./chain/reader";
import { ApiHttpError } from "./errors";
import type { Logger } from "./logger";
import { chainEventStore, type EventStore } from "./positions/events";
import { accountRoutes } from "./routes/accounts";
import { marketRoutes } from "./routes/markets";
import { quoteRoutes } from "./routes/quotes";
import { streamRoutes, type StreamOptions } from "./routes/stream";
import type { SwapSource } from "./swap/kyber";

export type AppDeps = {
  logger: Logger;
  reader?: ChainReader;
  swap?: SwapSource;
  /** The indexer's copy of router events. Without one, events are read from chain logs (tests on a fork). */
  events?: EventStore;
  stream?: StreamOptions;
};

export function createApp({ logger, reader, swap, events, stream }: AppDeps) {
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
    app.route("/", marketRoutes(reader));
    app.route("/", streamRoutes(reader, logger, stream));
    app.route("/", accountRoutes(reader, store));
    if (swap) app.route("/", quoteRoutes(reader, swap, store));
  }

  app.notFound(() => {
    throw new ApiHttpError("NOT_FOUND", "No such endpoint");
  });

  app.onError((err, c) => {
    if (err instanceof ApiHttpError) {
      if (err.status >= 500) logger.warn({ err, cause: err.cause }, err.message);
      return c.json(err.toBody(), err.status);
    }
    logger.error({ err }, "unhandled error");
    return c.json(new ApiHttpError("INTERNAL", "Internal error").toBody(), 500);
  });

  return app;
}
