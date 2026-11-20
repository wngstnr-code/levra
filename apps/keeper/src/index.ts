import { createDb } from "@levra/db";
import { createChainClient } from "./chain";
import { loadEnv } from "./env";
import { createJobs } from "./jobs";
import { createLogger } from "./logger";
import { runJob } from "./runner";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development").child({ chainId: env.CHAIN_ID });
const { db, close } = createDb(env.DATABASE_URL);
const jobs = createJobs(env, createChainClient(env.CHAIN_ID, env.rpcUrl), logger);
const controller = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    controller.abort();
  });
}

logger.info({ jobs: jobs.map((j) => j.name), global: env.KEEPER_GLOBAL }, "keeper starting");
await Promise.all(jobs.map((job) => runJob(job, { db, chainId: env.CHAIN_ID, logger, signal: controller.signal })));
await close();
logger.info("keeper stopped");
