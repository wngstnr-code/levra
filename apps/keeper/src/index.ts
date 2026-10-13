import { createDb } from "@levra/db";
import { createChainClient } from "./chain";
import { loadEnv } from "./env";
import { createJobs } from "./jobs";
import { createLogger } from "./logger";
import { runJob } from "./runner";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development");
const { db, close } = createDb(env.DATABASE_URL);
const jobs = createJobs(env, createChainClient(env.MONAD_RPC_URL), logger);
const controller = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    controller.abort();
  });
}

logger.info({ jobs: jobs.map((j) => j.name) }, "keeper starting");
await Promise.all(jobs.map((job) => runJob(job, { db, logger, signal: controller.signal })));
await close();
logger.info("keeper stopped");
