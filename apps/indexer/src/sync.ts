import { morphoEvents, routerCursor, routerEvents, syncCursors, vaultEvents, type Db } from "@levra/db";
import { externalByChain } from "@levra/shared/addresses";
import { isChainId } from "@levra/shared/chains";
import type { Deployment } from "@levra/shared/deployments";
import { and, eq, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { morphoTopics, toMorphoRow } from "./morpho";
import { routerTopics, toRouterRow } from "./router";
import { toVaultRow, vaultTopics } from "./vault";
import type { LogSource, RawLog } from "./sources/types";

export const ROUTER_CURSOR = "router_events";
export const MORPHO_CURSOR = "morpho_events";
export const VAULT_CURSOR = "vault_events";

export type SyncResult = { head: bigint; lastBlock: bigint; inserted: number };

/** One stream of logs into one table, with its own cursor. */
export type Stream = {
  cursor: string;
  address: Address | Address[];
  topic0: Hex[];
  topic1?: Hex[];
  table: typeof routerEvents | typeof morphoEvents | typeof vaultEvents;
  /** The row without its chain; `syncStream` adds the deployment's chain. */
  toRow: (log: RawLog) => Omit<typeof routerEvents.$inferInsert | typeof vaultEvents.$inferInsert, "chainId">;
};

/**
 * Every router of the deployment, current and previous (03 section 6, BE-100). Adding a router renames the cursor, so
 * all of them are read again from the deployment block; rows already stored only get their router filled in.
 */
export const routerStream = (deployment: Deployment): Stream => ({
  cursor: routerCursor(deployment),
  address: deployment.previousRouters?.length ? [deployment.router, ...deployment.previousRouters] : deployment.router,
  topic0: routerTopics,
  table: routerEvents,
  toRow: toRouterRow,
});

/** Morpho emits for every market on its chain; the market id in topic 1 keeps only ours. */
export const morphoStream = (deployment: Deployment): Stream => ({
  cursor: MORPHO_CURSOR,
  address: morphoOn(deployment.chainId),
  topic0: morphoTopics,
  topic1: deployment.markets.map((m) => m.marketId),
  table: morphoEvents,
  toRow: toMorphoRow,
});

/** The USDC vault, when the deployment has one (SC-23). */
export const vaultStream = (deployment: Deployment): Stream | null =>
  deployment.usdcVault
    ? { cursor: VAULT_CURSOR, address: deployment.usdcVault, topic0: vaultTopics, table: vaultEvents, toRow: toVaultRow }
    : null;

function morphoOn(chainId: number) {
  if (!isChainId(chainId)) throw new Error(`Deployment is for chain ${chainId}, which has no Morpho address in packages/shared`);
  return externalByChain[chainId].morpho;
}

/** Reads one stream from its cursor (or the deployment block) up to the head. At most `maxPages` pages per call. */
export async function syncStream(db: Db, source: LogSource, deployment: Deployment, stream: Stream, maxPages = 50): Promise<SyncResult> {
  const { chainId } = deployment;
  const head = await source.head();
  const [cursor] = await db
    .select()
    .from(syncCursors)
    .where(and(eq(syncCursors.chainId, chainId), eq(syncCursors.name, stream.cursor)));
  let from = cursor ? cursor.lastBlock + 1n : BigInt(deployment.block);
  let inserted = 0;

  for (let page = 0; page < maxPages && from <= head; page++) {
    const result = await source.logs({ address: stream.address, topic0: stream.topic0, topic1: stream.topic1, fromBlock: from, toBlock: head });
    if (result.nextBlock <= from) break;
    const rows = result.logs.map((log) => ({ ...stream.toRow(log), chainId }));
    const lastBlock = result.nextBlock - 1n;
    await db.transaction(async (tx) => {
      if (rows.length > 0) {
        // Each stream pairs a table with rows of that table; the union type cannot express the pairing.
        // A rescan after a router change fills the router of rows indexed before BE-100 (counted as written); nothing else changes.
        const written =
          stream.table === routerEvents
            ? tx
                .insert(routerEvents)
                .values(rows as never)
                .onConflictDoUpdate({ target: [routerEvents.chainId, routerEvents.txHash, routerEvents.logIndex], set: { router: sql`excluded.router` }, setWhere: sql`${routerEvents.router} is null` })
            : tx.insert(stream.table).values(rows as never).onConflictDoNothing();
        inserted += (await written.returning({ tx: stream.table.txHash })).length;
      }
      const row = { lastBlock, updatedAt: new Date() };
      await tx
        .insert(syncCursors)
        .values({ chainId, name: stream.cursor, ...row })
        .onConflictDoUpdate({ target: [syncCursors.chainId, syncCursors.name], set: row });
    });
    from = result.nextBlock;
  }

  return { head, lastBlock: from - 1n, inserted };
}

/** Router events only. Kept for callers that index the router alone. */
export function syncRouter(db: Db, source: LogSource, deployment: Deployment, maxPages = 50): Promise<SyncResult> {
  return syncStream(db, source, deployment, routerStream(deployment), maxPages);
}
