import { routerEvents, syncCursors, type Db } from "@levra/db";
import type { Deployment } from "@levra/shared/deployments";
import { eq } from "drizzle-orm";
import { routerTopics, toRouterRow } from "./router";
import type { LogSource } from "./sources/types";

export const ROUTER_CURSOR = "router_events";

export type SyncResult = { head: bigint; lastBlock: bigint; inserted: number };

/** Reads router events from the cursor (or the deployment block) up to the head. At most `maxPages` pages per call. */
export async function syncRouter(db: Db, source: LogSource, deployment: Deployment, maxPages = 50): Promise<SyncResult> {
  const head = await source.head();
  const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.name, ROUTER_CURSOR));
  let from = cursor ? cursor.lastBlock + 1n : BigInt(deployment.block);
  let inserted = 0;

  for (let page = 0; page < maxPages && from <= head; page++) {
    const result = await source.logs({ address: deployment.router, topic0: routerTopics, fromBlock: from, toBlock: head });
    if (result.nextBlock <= from) break;
    const rows = result.logs.map(toRouterRow);
    const lastBlock = result.nextBlock - 1n;
    await db.transaction(async (tx) => {
      if (rows.length > 0) {
        inserted += (await tx.insert(routerEvents).values(rows).onConflictDoNothing().returning({ tx: routerEvents.txHash })).length;
      }
      const row = { lastBlock, updatedAt: new Date() };
      await tx.insert(syncCursors).values({ name: ROUTER_CURSOR, ...row }).onConflictDoUpdate({ target: syncCursors.name, set: row });
    });
    from = result.nextBlock;
  }

  return { head, lastBlock: from - 1n, inserted };
}
