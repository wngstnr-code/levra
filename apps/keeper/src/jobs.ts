import { readDeployment } from "@levra/shared/deployments/node";
import { createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import type { Env } from "./env";
import type { Logger } from "./logger";
import { createOracleAgePoster } from "./oracle/age-poster";
import { createOracleRecorder } from "./oracle/recorder";
import type { Job } from "./runner";

export function createJobs(env: Env, client: PublicClient, logger: Logger): Job[] {
  const jobs: Job[] = [createOracleRecorder({ client, backfillBlocks: env.ORACLE_BACKFILL_BLOCKS })];

  if (env.ORACLE_AGE_POSTER_KEY && env.DEPLOYMENT_FILE) {
    const wallet = createWalletClient({
      account: privateKeyToAccount(env.ORACLE_AGE_POSTER_KEY as `0x${string}`),
      chain: monad,
      transport: http(env.MONAD_RPC_URL, { retryCount: 3, timeout: 20_000 }),
    });
    jobs.push(createOracleAgePoster({ client, wallet, deployment: readDeployment(env.DEPLOYMENT_FILE) }));
  } else {
    logger.info("oracle age poster off: ORACLE_AGE_POSTER_KEY or DEPLOYMENT_FILE is not set");
  }
  return jobs;
}
