import { morphoPositions, syncCursors, vaultEvents, type Db } from "@levra/db";
import { morphoAbi } from "@levra/shared/abis";
import { externalByChain } from "@levra/shared/addresses";
import { isChainId } from "@levra/shared/chains";
import type { Deployment } from "@levra/shared/deployments";
import { and, eq, lte, sql } from "drizzle-orm";
import { getAddress, type PublicClient } from "viem";
import type { LogSource } from "./sources/types";
import type { Stream } from "./sync";

/**
 * Checks that the indexed copy is complete (BE-91): after a move, a restore or a replay, every event of our contracts
 * on chain must be in the database once, and the positions rebuilt from Morpho events must equal Morpho's own.
 */

export type StreamCheck = { cursor: string; upToBlock: bigint; onChain: number; inDb: number; missing: string[]; extra: string[] };

const key = (txHash: string, logIndex: number) => `${txHash.toLowerCase()}:${logIndex}`;

/**
 * Every log of one stream from the deployment block to the stream's cursor, read again from the source, against the
 * rows stored for that chain up to the same block. Null when the stream has no cursor yet (never synced).
 */
export async function checkStream(db: Db, source: LogSource, deployment: Deployment, stream: Stream): Promise<StreamCheck | null> {
  const { chainId } = deployment;
  const [cursor] = await db
    .select()
    .from(syncCursors)
    .where(and(eq(syncCursors.chainId, chainId), eq(syncCursors.name, stream.cursor)));
  if (!cursor) return null;
  const upToBlock = cursor.lastBlock;

  const onChain = new Set<string>();
  let from = BigInt(deployment.block);
  while (from <= upToBlock) {
    const page = await source.logs({ address: stream.address, topic0: stream.topic0, topic1: stream.topic1, fromBlock: from, toBlock: upToBlock });
    if (page.nextBlock <= from) throw new Error(`${source.name} made no progress at block ${from}`);
    for (const log of page.logs) onChain.add(key(log.txHash, log.logIndex));
    from = page.nextBlock;
  }

  // The three event tables share these columns; the union type cannot express that.
  const table = stream.table as typeof vaultEvents;
  const rows = await db
    .select({ txHash: table.txHash, logIndex: table.logIndex })
    .from(table)
    .where(and(eq(table.chainId, chainId), lte(table.blockNumber, upToBlock)));
  const inDb = new Set(rows.map((r) => key(r.txHash, r.logIndex)));

  return {
    cursor: stream.cursor,
    upToBlock,
    onChain: onChain.size,
    inDb: inDb.size,
    missing: [...onChain].filter((k) => !inDb.has(k)),
    extra: [...inDb].filter((k) => !onChain.has(k)),
  };
}

export type PositionMismatch = { user: string; marketId: string; indexed: { collateral: bigint; borrowShares: bigint }; onChain: { collateral: bigint; borrowShares: bigint } };

/**
 * Every user and market in our markets with a Morpho event, closed ones included, rebuilt from `morpho_events` and
 * compared with `Morpho.position` read now. A closed position that is still open on chain counts as a mismatch.
 */
export async function checkPositions(db: Db, client: PublicClient, deployment: Deployment): Promise<{ checked: number; open: number; mismatches: PositionMismatch[] }> {
  if (!isChainId(deployment.chainId)) throw new Error(`Chain ${deployment.chainId} has no Morpho address in packages/shared`);
  const morpho = externalByChain[deployment.chainId].morpho;
  const ours = new Set(deployment.markets.map((m) => m.marketId.toLowerCase()));
  const pairKey = (user: string, marketId: string) => `${user}:${marketId}`;
  const open = new Map((await morphoPositions(db, deployment.chainId)).map((p) => [pairKey(p.user, p.marketId), p]));
  const pairs = (await db.execute(sql`
    select distinct "user", market_id from morpho_events where chain_id = ${deployment.chainId}
  `)) as unknown as { user: string; market_id: string }[];
  const indexed = pairs
    .filter((r) => ours.has(r.market_id))
    .map((r) => open.get(pairKey(r.user, r.market_id)) ?? { user: r.user, marketId: r.market_id, collateral: 0n, borrowShares: 0n });
  if (indexed.length === 0) return { checked: 0, open: 0, mismatches: [] };
  const onChain = await client.multicall({
    allowFailure: false,
    contracts: indexed.map((p) => ({ address: morpho, abi: morphoAbi, functionName: "position", args: [p.marketId as `0x${string}`, getAddress(p.user)] }) as const),
  });
  const mismatches = indexed.flatMap((p, i) => {
    const c = onChain[i]!;
    return c.collateral === p.collateral && c.borrowShares === p.borrowShares
      ? []
      : [{ user: p.user, marketId: p.marketId, indexed: { collateral: p.collateral, borrowShares: p.borrowShares }, onChain: { collateral: c.collateral, borrowShares: c.borrowShares } }];
  });
  return { checked: indexed.length, open: indexed.filter((p) => p.collateral !== 0n || p.borrowShares !== 0n).length, mismatches };
}

export type Traction = {
  router: { name: string; events: number; wallets: number }[];
  vault: { name: string; events: number; wallets: number }[];
  /** Wallets that opened a position or used the vault. */
  wallets: number;
  firstAt: Date | null;
  lastAt: Date | null;
};

/** What the indexed events say about use, per chain: event counts and distinct wallets. Counts only, no amounts. */
export async function traction(db: Db, chainId: number): Promise<Traction> {
  const router = (await db.execute(sql`
    select name, count(*)::int as events, count(distinct "user")::int as wallets
    from router_events where chain_id = ${chainId} group by name order by name
  `)) as unknown as Traction["router"];
  const vault = (await db.execute(sql`
    select name, count(*)::int as events, count(distinct "user")::int as wallets
    from vault_events where chain_id = ${chainId} group by name order by name
  `)) as unknown as Traction["vault"];
  const [all] = (await db.execute(sql`
    select count(distinct "user")::int as wallets, min(block_time) as first_at, max(block_time) as last_at from (
      select "user", block_time from router_events where chain_id = ${chainId} and name = 'PositionOpened'
      union all
      select "user", block_time from vault_events where chain_id = ${chainId}
    ) u
  `)) as unknown as { wallets: number; first_at: Date | string | null; last_at: Date | string | null }[];
  const date = (v: Date | string | null | undefined) => (v ? new Date(v) : null);
  return { router, vault, wallets: all?.wallets ?? 0, firstAt: date(all?.first_at), lastAt: date(all?.last_at) };
}
