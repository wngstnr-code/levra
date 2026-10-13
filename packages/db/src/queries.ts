import { sql } from "drizzle-orm";
import type { Db } from "./client";

export type EventPosition = { user: string; marketId: string; collateral: bigint; borrowShares: bigint };

/**
 * Morpho positions rebuilt from `morpho_events`: collateral in base units and borrow shares, per user and market.
 * Matches `Morpho.position()` when the events are complete from the market's creation.
 */
export async function morphoPositions(db: Db, filter: { user?: string; marketId?: string } = {}): Promise<EventPosition[]> {
  const rows = (await db.execute(sql`
    select "user", market_id,
      sum(case name
        when 'SupplyCollateral' then (args->>'assets')::numeric
        when 'WithdrawCollateral' then -(args->>'assets')::numeric
        when 'Liquidate' then -(args->>'seizedAssets')::numeric
        else 0 end)::text as collateral,
      sum(case name
        when 'Borrow' then (args->>'shares')::numeric
        when 'Repay' then -(args->>'shares')::numeric
        when 'Liquidate' then -((args->>'repaidShares')::numeric + (args->>'badDebtShares')::numeric)
        else 0 end)::text as borrow_shares
    from morpho_events
    where (${filter.user ?? null}::text is null or "user" = ${filter.user?.toLowerCase() ?? null})
      and (${filter.marketId ?? null}::text is null or market_id = ${filter.marketId?.toLowerCase() ?? null})
    group by "user", market_id
  `)) as unknown as { user: string; market_id: string; collateral: string; borrow_shares: string }[];
  return rows
    .map((r) => ({ user: r.user, marketId: r.market_id, collateral: BigInt(r.collateral), borrowShares: BigInt(r.borrow_shares) }))
    .filter((p) => p.collateral !== 0n || p.borrowShares !== 0n);
}
