import { oracleUpdates, syncCursors, type Db } from "@levra/db";
import { external } from "@levra/shared/addresses";
import { and, eq } from "drizzle-orm";
import type { PublicClient } from "viem";
import type { Job } from "../runner";
import { priceUpdatedEvent, toOracleRow, trackedPriceIds } from "./decode";

export const ORACLE_CURSOR = "oracle_updates";
/** rpc2.monad.xyz allows at most 10,000 blocks per log query. */
const BLOCK_RANGE = 10_000n;

export type OracleRecorderOptions = {
  client: PublicClient;
  backfillBlocks: bigint;
  maxRangesPerRun?: number;
  intervalMs?: number;
};

async function readCursor(db: Db, chainId: number): Promise<bigint | null> {
  const [row] = await db
    .select()
    .from(syncCursors)
    .where(and(eq(syncCursors.chainId, chainId), eq(syncCursors.name, ORACLE_CURSOR)));
  return row?.lastBlock ?? null;
}

/** Follows every Anchored `PriceUpdated` log for our Monad stocks, starting `backfillBlocks` behind the head on first start. */
export function createOracleRecorder({
  client,
  backfillBlocks,
  maxRangesPerRun = 100,
  intervalMs = 5_000,
}: OracleRecorderOptions): Job {
  return {
    name: "oracleMonitor",
    intervalMs,
    async run({ db, chainId, logger, signal }) {
      const head = await client.getBlockNumber();
      const cursor = await readCursor(db, chainId);
      let from = cursor === null ? (head > backfillBlocks ? head - backfillBlocks : 0n) : cursor + 1n;
      let inserted = 0;
      let ranges = 0;

      while (from <= head && ranges < maxRangesPerRun && !signal.aborted) {
        const to = from + BLOCK_RANGE - 1n < head ? from + BLOCK_RANGE - 1n : head;
        const logs = await client.getLogs({
          address: external.anchoredStockOracle,
          event: priceUpdatedEvent,
          args: { priceId: trackedPriceIds },
          fromBlock: from,
          toBlock: to,
          strict: true,
        });
        const rows = logs.map((log) => ({ ...toOracleRow(log), chainId }));
        await db.transaction(async (tx) => {
          if (rows.length > 0) {
            const result = await tx.insert(oracleUpdates).values(rows).onConflictDoNothing().returning({ tx: oracleUpdates.txHash });
            inserted += result.length;
          }
          const cursorRow = { lastBlock: to, updatedAt: new Date() };
          await tx
            .insert(syncCursors)
            .values({ chainId, name: ORACLE_CURSOR, ...cursorRow })
            .onConflictDoUpdate({ target: [syncCursors.chainId, syncCursors.name], set: cursorRow });
        });
        from = to + 1n;
        ranges += 1;
      }

      const lastBlock = from - 1n;
      if (head - lastBlock > BLOCK_RANGE) logger.info({ lastBlock: Number(lastBlock), head: Number(head) }, "oracle backfill in progress");
      return { head: Number(head), lastBlock: Number(lastBlock), behindBlocks: Number(head - lastBlock), inserted };
    },
  };
}
