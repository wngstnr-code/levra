import { createDb } from "@levra/db";
import { readDeployment } from "@levra/shared/deployments/node";
import { setTimeout as sleep } from "node:timers/promises";
import { createPublicClient, http } from "viem";
import { monad } from "viem/chains";
import { loadEnv } from "./env";
import { createLogger } from "./logger";
import { hyperSyncSource } from "./sources/hypersync";
import { rpcSource } from "./sources/rpc";
import { morphoStream, routerStream, syncStream } from "./sync";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development");
const deployment = readDeployment(env.DEPLOYMENT_FILE);
const { db, close } = createDb(env.DATABASE_URL);
const source = env.ENVIO_API_TOKEN
  ? hyperSyncSource({ url: env.HYPERSYNC_URL, token: env.ENVIO_API_TOKEN })
  : rpcSource(createPublicClient({ chain: monad, transport: http(env.MONAD_RPC_URL, { retryCount: 3, timeout: 20_000 }) }));

const streams = [routerStream(deployment), morphoStream(deployment)];
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    stopping = true;
  });
}

logger.info({ source: source.name, router: deployment.router, fromBlock: deployment.block }, "indexer starting");
while (!stopping) {
  for (const stream of streams) {
    try {
      const result = await syncStream(db, source, deployment, stream);
      if (result.inserted > 0 || result.head - result.lastBlock > 10_000n) {
        logger.info({ stream: stream.cursor, inserted: result.inserted, lastBlock: Number(result.lastBlock), head: Number(result.head) }, "events synced");
      }
    } catch (err) {
      logger.error({ err, stream: stream.cursor }, "sync failed");
    }
  }
  await sleep(env.POLL_MS);
}
await close();
