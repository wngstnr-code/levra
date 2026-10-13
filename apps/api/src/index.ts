import { serve } from "@hono/node-server";
import { createDb } from "@levra/db";
import { readDeployment } from "@levra/shared/deployments/node";
import { createApp } from "./app";
import { createChainClient } from "./chain/client";
import { createChainReader } from "./chain/reader";
import { loadEnv } from "./env";
import { createLogger } from "./logger";
import { dbEventStore } from "./positions/events";
import { createKyber } from "@levra/kyber";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development");
const deployment = readDeployment(env.DEPLOYMENT_FILE);
const { db, close } = createDb(env.DATABASE_URL);
const reader = createChainReader(createChainClient(env.MONAD_RPC_URL), deployment);
const swap = createKyber({ baseUrl: env.KYBER_BASE_URL, clientId: env.KYBER_CLIENT_ID });
const auth = env.AUTH_SECRET && env.AUTH_DOMAIN ? { secret: env.AUTH_SECRET, domain: env.AUTH_DOMAIN, telegramBot: env.TELEGRAM_BOT_USERNAME } : undefined;
if (!auth) logger.info("sign-in and alert routes off: AUTH_SECRET or AUTH_DOMAIN is not set");
const app = createApp({ logger, reader, swap, events: dbEventStore(db), db, version: env.APP_VERSION, auth });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, chainId: deployment.chainId, markets: deployment.markets.length }, "api listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => void close().then(() => process.exit(0)));
  });
}
