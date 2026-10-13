import type { Db } from "@levra/db";
import type { HealthResponse } from "@levra/shared/api";
import { Hono } from "hono";
import type { ChainReader } from "./chain/reader";
import { ApiHttpError, fromSwapError } from "./errors";
import type { Logger } from "./logger";
import { chainEventStore, type EventStore } from "./positions/events";
import { accountRoutes } from "./routes/accounts";
import { alertRoutes } from "./routes/alerts";
import { depositRoutes } from "./routes/deposit";
import { complianceRoutes, createCompliance, type ComplianceOptions } from "./routes/compliance";
import type { IntentsSource } from "@levra/intents";
import { authRoutes } from "./routes/auth";
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
  /** Wallet sign-in and alert settings (BE-33). Off without it; needs `db`. */
  auth?: { secret: string; domain: string; telegramBot?: string };
  /** Cross-chain deposits and withdrawals (BE-40, BE-41). Needs `db`. */
  intents?: IntentsSource;
  /** Region and terms (BE-52). Needs `db` and `reader`. Without it, opening and depositing are not gated. */
  compliance?: ComplianceOptions;
};

/** DEX mid prices no older than 30 minutes from the depth keeper, cached for 30 seconds. Initial proposal. */
function dexMidsFromDb(db: Db): DexMids {
  const cached = createCache();
  return () => cached("dexMids", 30_000, () => latestDexMids(db, 1_800));
}

export function createApp({ logger, reader, swap, events, stream, db, version = "dev", auth, intents, compliance: complianceOpts }: AppDeps) {
  const app = new Hono();
  const compliance = db && complianceOpts ? createCompliance(db, complianceOpts) : undefined;

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
    if (swap) app.route("/", quoteRoutes(reader, swap, store, compliance));
    if (db && compliance && complianceOpts) app.route("/", complianceRoutes(db, reader.client, compliance, complianceOpts));
    if (db) app.route("/", statusRoutes(reader, db, version));
    if (db && auth) {
      app.route("/", authRoutes(reader.client, db, { secret: auth.secret, domain: auth.domain, chainId: reader.deployment.chainId }));
      app.route("/", alertRoutes(db, { secret: auth.secret, telegramBot: auth.telegramBot }));
    }
  }

  if (db && intents) app.route("/", depositRoutes(db, intents, compliance));

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
