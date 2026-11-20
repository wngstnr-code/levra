import { keeperHeartbeats, type Db } from "@levra/db";
import type { KeeperName } from "@levra/shared/api";
import type { ChainId } from "@levra/shared/chains";
import type { Logger } from "./logger";

/** `chainId` is the chain this keeper process serves (BE-95); every row a job writes carries it. */
export type JobContext = { db: Db; chainId: ChainId; logger: Logger; signal: AbortSignal };

export type Job = {
  name: KeeperName;
  intervalMs: number;
  /** Returned details are stored with the heartbeat. */
  run(ctx: JobContext): Promise<Record<string, unknown> | void>;
};

export async function beat(db: Db, chainId: ChainId, name: KeeperName, error: string | null, details?: Record<string, unknown>) {
  const row = { lastBeatAt: new Date(), lastError: error, details: details ?? null };
  await db
    .insert(keeperHeartbeats)
    .values({ chainId, name, ...row })
    .onConflictDoUpdate({ target: [keeperHeartbeats.chainId, keeperHeartbeats.name], set: row });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** Runs one job forever: run, record a heartbeat, wait, repeat. A failed run is logged and retried next interval. */
export async function runJob(job: Job, ctx: JobContext): Promise<void> {
  const log = ctx.logger.child({ job: job.name });
  while (!ctx.signal.aborted) {
    try {
      const details = await job.run({ ...ctx, logger: log });
      await beat(ctx.db, ctx.chainId, job.name, null, details ?? undefined);
    } catch (err) {
      log.error({ err }, "job run failed");
      await beat(ctx.db, ctx.chainId, job.name, err instanceof Error ? err.message : String(err)).catch((beatErr) =>
        log.error({ err: beatErr }, "heartbeat failed"),
      );
    }
    await sleep(job.intervalMs, ctx.signal);
  }
}
