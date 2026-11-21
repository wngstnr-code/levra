import type { Db } from "@levra/db";
import type { ChainsResponse, HealthResponse } from "@levra/shared/api";
import { chainIds, chains, DEFAULT_CHAIN_ID, isChainId } from "@levra/shared/chains";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { matchesAny } from "./origins";
import { rateLimit, type RateLimitOptions } from "./rate-limit/middleware";
import type { ChainReader } from "./chain/reader";
import { ApiHttpError, fromSwapError } from "./errors";
import type { Logger } from "./logger";
import { chainEventStore, dbEventStore, type EventStore } from "./positions/events";
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
  /** Readers of the other chains that have a deployment (BE-95), served at `/v1/:chainId/...` (BE-70) and in /v1/status. */
  otherChains?: ChainReader[];
  version?: string;
  /** Wallet sign-in and alert settings (BE-33). Off without it; needs `db`. */
  auth?: { secret: string; domains: RegExp[]; telegramBot?: string };
  /** Web origins allowed to call the API from a browser (BE-56). None: no CORS headers, same-origin only. */
  corsOrigins?: RegExp[];
  /** Limits per IP address and wallet (BE-51). Off when not given (tests). */
  rateLimit?: RateLimitOptions;
  /** Cross-chain deposits and withdrawals (BE-40, BE-41). Needs `db`. */
  intents?: IntentsSource;
  /** Region and terms (BE-52). Needs `db` and `reader`. Without it, opening and depositing are not gated. */
  compliance?: ComplianceOptions;
};

/** DEX mid prices no older than 30 minutes from the depth keeper, cached for 30 seconds. Initial proposal. */
function dexMidsFromDb(db: Db, chainId: number): DexMids {
  const cached = createCache();
  return () => cached("dexMids", 30_000, () => latestDexMids(db, chainId, 1_800));
}

export function createApp({ logger, reader, otherChains = [], swap, events, stream, db, version = "dev", auth, intents, compliance: complianceOpts, corsOrigins = [], rateLimit: limits }: AppDeps) {
  const app = new Hono();
  if (corsOrigins.length > 0) {
    app.use(
      "*",
      cors({
        origin: (origin) => (origin && matchesAny(corsOrigins, origin) ? origin : null),
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["content-type", "authorization"],
        maxAge: 600,
      }),
    );
  }
  // After CORS, so a 429 still carries the CORS headers and the browser can read it.
  if (limits) app.use("*", rateLimit(limits));
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

  const live = [...(reader ? [reader] : []), ...otherChains];
  app.get("/v1/chains", (c) =>
    c.json({
      chains: chainIds.map((id) => ({ chainId: id, slug: chains[id].slug, name: chains[id].name, nativeSymbol: chains[id].nativeSymbol, live: live.some((r) => r.deployment.chainId === id) })),
      defaultChainId: DEFAULT_CHAIN_ID,
    } satisfies ChainsResponse),
  );

  /** The routes of one chain (BE-70), served at `/v1/:chainId/...` and, for the main reader, without the chain ID. */
  const chainApp = (r: ChainReader, store: EventStore, chainSwap: SwapSource | undefined) => {
    const id = r.deployment.chainId;
    const mids = db ? dexMidsFromDb(db, id) : undefined;
    const sub = new Hono();
    sub.route("/", marketRoutes(r, mids, db ? dbMarketHistory(db, id) : undefined));
    sub.route("/", streamRoutes(r, logger, stream, mids));
    sub.route("/", accountRoutes(r, store));
    sub.route("/", earnRoutes(r, store));
    // Quotes need a swap provider for the chain: KyberSwap on Monad today, Base and X Layer with BE-96 and BE-72.
    // Region and terms belong to the wallet, so the same gate applies on every chain.
    if (chainSwap) sub.route("/", quoteRoutes(r, chainSwap, store, compliance));
    sub.notFound(notFound);
    sub.onError(onError);
    return sub;
  };
  const chainApps = new Map<number, Hono>();
  if (reader) chainApps.set(reader.deployment.chainId, chainApp(reader, events ?? chainEventStore(reader), swap));
  for (const r of otherChains) chainApps.set(r.deployment.chainId, chainApp(r, db ? dbEventStore(db, r.deployment.chainId) : chainEventStore(r), undefined));

  app.all("/v1/:chainId{[0-9]+}/*", async (c) => {
    const id = Number(c.req.param("chainId"));
    if (!isChainId(id)) throw new ApiHttpError("NOT_FOUND", `Unknown chain ${id}`);
    const sub = chainApps.get(id);
    if (!sub) throw new ApiHttpError("NOT_FOUND", `${chains[id].name} is not live on this API yet`, { chainId: id, live: false });
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(`/v1/${id}/`, "/v1/");
    return sub.fetch(new Request(url, c.req.raw));
  });

  if (reader) {
    // The routes without a chain ID serve the main reader's chain (Monad) until the web app has moved (BE-70).
    app.route("/", chainApps.get(reader.deployment.chainId)!);
    if (db && compliance && complianceOpts) app.route("/", complianceRoutes(db, reader.client, compliance, complianceOpts));
    if (db) app.route("/", statusRoutes([reader, ...otherChains], db, version));
    if (db && auth) {
      app.route("/", authRoutes(new Map(live.map((r) => [r.deployment.chainId, r.client])), db, { secret: auth.secret, domains: auth.domains }));
      app.route("/", alertRoutes(db, { secret: auth.secret, telegramBot: auth.telegramBot }));
    }
  }

  if (db && intents) app.route("/", depositRoutes(db, intents, compliance));

  app.notFound(notFound);
  app.onError(onError);
  return app;

  function notFound(): never {
    throw new ApiHttpError("NOT_FOUND", "No such endpoint");
  }

  function onError(err: Error, c: Context) {
    if (err instanceof SwapError) err = fromSwapError(err);
    if (err instanceof ApiHttpError) {
      if (err.status >= 500) logger.warn({ err, cause: err.cause }, err.message);
      return c.json(err.toBody(), err.status);
    }
    logger.error({ err }, "unhandled error");
    return c.json(new ApiHttpError("INTERNAL", "Internal error").toBody(), 500);
  }
}
