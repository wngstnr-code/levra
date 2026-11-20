import { createDb } from "@levra/db";
import { readDeployment } from "@levra/shared/deployments/node";
import { setTimeout as sleep } from "node:timers/promises";
import { createPublicClient, http, type PublicClient } from "viem";
import { base, monad, xLayer } from "viem/chains";
import { loadEnv } from "./env";
import { createLogger } from "./logger";
import { hyperSyncSource } from "./sources/hypersync";
import { rpcSource } from "./sources/rpc";
import { morphoStream, routerStream, syncStream, vaultStream, type Stream } from "./sync";

const viemChains = { 143: monad, 8453: base, 196: xLayer } as const;

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development").child({ chainId: env.CHAIN_ID });
const deployment = readDeployment(env.DEPLOYMENT_FILE);
if (deployment.chainId !== env.CHAIN_ID) {
  throw new Error(`DEPLOYMENT_FILE is for chain ${deployment.chainId}, but CHAIN_ID is ${env.CHAIN_ID}`);
}
const { db, close } = createDb(env.DATABASE_URL);
const source =
  env.ENVIO_API_TOKEN && env.hyperSyncUrl
    ? hyperSyncSource({ url: env.hyperSyncUrl, token: env.ENVIO_API_TOKEN })
    : // Base's OP stack formatters widen the block type; the indexer reads only logs and block times.
      rpcSource(createPublicClient({ chain: viemChains[env.CHAIN_ID], transport: http(env.rpcUrl, { retryCount: 3, timeout: 20_000 }) }) as PublicClient);

const streams = [routerStream(deployment), morphoStream(deployment), vaultStream(deployment)].filter((s): s is Stream => s !== null);
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
