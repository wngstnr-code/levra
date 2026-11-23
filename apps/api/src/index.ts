import { serve } from "@hono/node-server";
import { createDb } from "@levra/db";
import { BASE_CHAIN_ID, MONAD_CHAIN_ID, XLAYER_CHAIN_ID } from "@levra/shared/addresses";
import type { ChainId } from "@levra/shared/chains";
import { readDeployment } from "@levra/shared/deployments/node";
import { createApp } from "./app";
import { createChainClient } from "./chain/client";
import { createChainReader, type ChainReader } from "./chain/reader";
import { routeForRouter, swapProviders } from "./chain/swap";
import { loadEnv } from "./env";
import { createLogger } from "./logger";
import { dbEventStore } from "./positions/events";
import { createIntents } from "@levra/intents";
import { parsePatterns } from "./origins";
import { countryList } from "./routes/compliance";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development");
/** A chain with a deployment file of the wrong chain refuses to start, so its data is never served under another chain. */
function loadChain(chainId: ChainId, rpcUrl: string, file: string) {
  const deployment = readDeployment(file);
  if (deployment.chainId !== chainId) throw new Error(`${file} is for chain ${deployment.chainId}, expected ${chainId}`);
  return createChainReader(createChainClient(chainId, rpcUrl), deployment);
}
const reader = loadChain(MONAD_CHAIN_ID, env.MONAD_RPC_URL, env.DEPLOYMENT_FILE);
const deployment = reader.deployment;
const otherChains = [
  ...(env.BASE_RPC_URL && env.BASE_DEPLOYMENT_FILE ? [loadChain(BASE_CHAIN_ID, env.BASE_RPC_URL, env.BASE_DEPLOYMENT_FILE)] : []),
  ...(env.XLAYER_RPC_URL && env.XLAYER_DEPLOYMENT_FILE ? [loadChain(XLAYER_CHAIN_ID, env.XLAYER_RPC_URL, env.XLAYER_DEPLOYMENT_FILE)] : []),
];
const { db, close } = createDb(env.DATABASE_URL);
// Each chain quotes through the providers its router accepts; each HTTP provider has its own budget (BE-96, BE-51).
const okx = env.OKX_API_KEY && env.OKX_SECRET_KEY && env.OKX_API_PASSPHRASE ? { apiKey: env.OKX_API_KEY, secretKey: env.OKX_SECRET_KEY, passphrase: env.OKX_API_PASSPHRASE } : undefined;
const swapKeys = { kyberClientId: env.KYBER_CLIENT_ID, kyberApiKey: env.KYBER_API_KEY, kyberMonadUrl: env.KYBER_BASE_URL, oneInchApiKey: env.ONEINCH_API_KEY, okx };
const routeOf = (r: ChainReader) => routeForRouter(r.client, r.deployment.router, swapProviders(r.deployment.chainId as ChainId, r.client, swapKeys));
const swap = routeOf(reader) ?? undefined;
const otherSwaps = new Map(otherChains.flatMap((r) => {
  const route = routeOf(r);
  return route ? [[r.deployment.chainId, route] as const] : [];
}));
const auth = env.AUTH_SECRET && env.AUTH_DOMAIN ? { secret: env.AUTH_SECRET, domains: parsePatterns(env.AUTH_DOMAIN), telegramBot: env.TELEGRAM_BOT_USERNAME } : undefined;
const corsOrigins = parsePatterns(env.CORS_ORIGINS);
if (corsOrigins.length === 0) logger.warn("CORS_ORIGINS is not set: browsers on other origins cannot call the API");
if (!auth) logger.info("sign-in and alert routes off: AUTH_SECRET or AUTH_DOMAIN is not set");
const intents = createIntents({ jwt: env.INTENTS_JWT });
const blockedCountries = countryList("BLOCKED_COUNTRIES", env.BLOCKED_COUNTRIES);
const blockedCountriesByChain = new Map([
  [BASE_CHAIN_ID, countryList("BASE_BLOCKED_COUNTRIES", env.BASE_BLOCKED_COUNTRIES)],
  [XLAYER_CHAIN_ID, countryList("XLAYER_BLOCKED_COUNTRIES", env.XLAYER_BLOCKED_COUNTRIES)],
]);
const anyCountries = blockedCountries.size > 0 || [...blockedCountriesByChain.values()].some((s) => s.size > 0);
if (anyCountries && !env.GEO_COUNTRY_HEADER) throw new Error("A country block list needs GEO_COUNTRY_HEADER to know the visitor's country");
const blockedRegions = new Set((env.BLOCKED_REGIONS ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean));
if (blockedRegions.size > 0 && !(env.GEO_REGION_HEADER && env.GEO_COUNTRY_HEADER)) throw new Error("BLOCKED_REGIONS needs GEO_REGION_HEADER and GEO_COUNTRY_HEADER");
const compliance = env.TERMS_VERSION ? { termsVersion: env.TERMS_VERSION, countryHeader: env.GEO_COUNTRY_HEADER, blockedCountries, blockedCountriesByChain, regionHeader: env.GEO_REGION_HEADER, blockedRegions } : undefined;
if (!compliance) logger.warn("region and terms routes off: TERMS_VERSION is not set; the web app cannot pass its gate");
const agent = env.WEB_APP_URL ? { webAppUrl: env.WEB_APP_URL } : undefined;
if (!agent) logger.info("agent routes off: WEB_APP_URL is not set");
const app = createApp({ logger, reader, otherChains, otherSwaps, swap, events: dbEventStore(db, deployment.chainId), db, version: env.APP_VERSION, auth, intents, agent, compliance, corsOrigins, rateLimit: { trustProxyHeader: env.TRUST_PROXY_HEADER } });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, chainId: deployment.chainId, markets: deployment.markets.length, otherChains: otherChains.map((r) => r.deployment.chainId) }, "api listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => void close().then(() => process.exit(0)));
  });
}
