import { morphoEvents, routerEvents, syncCursors, type Db } from "@levra/db";
import { external } from "@levra/shared/addresses";
import type { Deployment } from "@levra/shared/deployments";
import { eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { morphoTopics, toMorphoRow } from "./morpho";
import { routerTopics, toRouterRow } from "./router";
import type { LogSource, RawLog } from "./sources/types";

export const ROUTER_CURSOR = "router_events";
export const MORPHO_CURSOR = "morpho_events";

export type SyncResult = { head: bigint; lastBlock: bigint; inserted: number };

/** One stream of logs into one table, with its own cursor. */
export type Stream = {
  cursor: string;
  address: Address;
  topic0: Hex[];
  topic1?: Hex[];
  table: typeof routerEvents | typeof morphoEvents;
  toRow: (log: RawLog) => typeof routerEvents.$inferInsert;
};

export const routerStream = (deployment: Deployment): Stream => ({
  cursor: ROUTER_CURSOR,
  address: deployment.router,
  topic0: routerTopics,
  table: routerEvents,
  toRow: toRouterRow,
});

/** Morpho emits for every market on Monad; the market id in topic 1 keeps only ours. */
export const morphoStream = (deployment: Deployment): Stream => ({
  cursor: MORPHO_CURSOR,
  address: external.morpho,
  topic0: morphoTopics,
  topic1: deployment.markets.map((m) => m.marketId),
  table: morphoEvents,
  toRow: toMorphoRow,
});

/** Reads one stream from its cursor (or the deployment block) up to the head. At most `maxPages` pages per call. */
export async function syncStream(db: Db, source: LogSource, deployment: Deployment, stream: Stream, maxPages = 50): Promise<SyncResult> {
  const head = await source.head();
  const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.name, stream.cursor));
  let from = cursor ? cursor.lastBlock + 1n : BigInt(deployment.block);
  let inserted = 0;

  for (let page = 0; page < maxPages && from <= head; page++) {
    const result = await source.logs({ address: stream.address, topic0: stream.topic0, topic1: stream.topic1, fromBlock: from, toBlock: head });
    if (result.nextBlock <= from) break;
    const rows = result.logs.map(stream.toRow);
    const lastBlock = result.nextBlock - 1n;
    await db.transaction(async (tx) => {
      if (rows.length > 0) {
        inserted += (await tx.insert(stream.table).values(rows).onConflictDoNothing().returning({ tx: stream.table.txHash })).length;
      }
      const row = { lastBlock, updatedAt: new Date() };
      await tx.insert(syncCursors).values({ name: stream.cursor, ...row }).onConflictDoUpdate({ target: syncCursors.name, set: row });
    });
    from = result.nextBlock;
  }

  return { head, lastBlock: from - 1n, inserted };
}

/** Router events only. Kept for callers that index the router alone. */
export function syncRouter(db: Db, source: LogSource, deployment: Deployment, maxPages = 50): Promise<SyncResult> {
  return syncStream(db, source, deployment, routerStream(deployment), maxPages);
}
