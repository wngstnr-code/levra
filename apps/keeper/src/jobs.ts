import type { PublicClient } from "viem";
import type { Env } from "./env";
import { createOracleRecorder } from "./oracle/recorder";
import type { Job } from "./runner";

export function createJobs(env: Env, client: PublicClient): Job[] {
  return [createOracleRecorder({ client, backfillBlocks: env.ORACLE_BACKFILL_BLOCKS })];
}
