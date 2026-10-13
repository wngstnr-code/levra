import { deposits } from "@levra/db";
import { FINAL_STATUSES, IntentsError, refreshTransfer, type IntentsSource } from "@levra/intents";
import { and, eq, gte, notInArray } from "drizzle-orm";
import type { Job } from "../runner";

/** The service keeps a deposit address open for about three days after the quote; a day more covers a late refund. */
const WATCH_DAYS = 4;

/**
 * Follows every open cross-chain transfer until it is completed, refunded, failed or expired (BE-40), so the status
 * and the arrival alert (BE-33) do not depend on the user keeping the app open.
 */
export function createTransferWatcher({ intents, intervalMs = 15_000 }: { intents: IntentsSource; intervalMs?: number }): Job {
  return {
    name: "transfers",
    intervalMs,
    async run({ db, logger }) {
      const since = new Date(Date.now() - WATCH_DAYS * 86_400_000);
      const open = await db
        .select()
        .from(deposits)
        .where(and(notInArray(deposits.status, [...FINAL_STATUSES]), gte(deposits.createdAt, since)));
      let changed = 0;
      let failed = 0;
      for (const row of open) {
        try {
          const values = await refreshTransfer(intents, row);
          await db.update(deposits).set(values).where(eq(deposits.id, row.id));
          if (values.status !== row.status) {
            changed += 1;
            logger.info({ id: row.id, kind: row.kind, from: row.status, to: values.status, upstream: values.upstreamStatus }, "transfer status changed");
          }
        } catch (err) {
          if (!(err instanceof IntentsError)) throw err;
          failed += 1;
          logger.warn({ id: row.id, err: err.message }, "transfer status read failed, retrying next run");
        }
      }
      if (failed > 0 && failed === open.length) throw new Error(`The cross-chain service failed for all ${failed} open transfer(s)`);
      return { open: open.length, changed, failed };
    },
  };
}
