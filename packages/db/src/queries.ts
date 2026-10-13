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

/** Users and markets whose latest `ProtectionSet` switched protection on (BE-31). The chain has the final word. */
export async function protectedPositions(db: Db): Promise<{ user: string; marketId: string }[]> {
  const rows = (await db.execute(sql`
    select "user", market_id from (
      select distinct on ("user", market_id) "user", market_id, (args->>'enabled')::boolean as enabled
      from router_events
      where name = 'ProtectionSet'
      order by "user", market_id, block_number desc, log_index desc
    ) latest where enabled
  `)) as unknown as { user: string; market_id: string }[];
  return rows.map((r) => ({ user: r.user, marketId: r.market_id }));
}

/**
 * When the oracle goes `CLOSED` and comes back, learned from `oracle_updates` (BE-30). Only fully observed stretches of
 * at least `minHours` count (weekends and holidays). The close is the first `CLOSED` write that starts the stretch,
 * including the Friday flips back to `POST_MARKET` (04), and the open is the first write after it.
 * Times are returned as unix seconds; the calendar turns them into offsets. Empty until a weekend is in the data.
 */
export async function observedClosedStretches(db: Db, minHours = 40): Promise<{ symbol: string; firstClosedAt: number; reopenedAt: number }[]> {
  const rows = (await db.execute(sql`
    with t as (
      select symbol, session, block_time,
        lag(session) over (partition by symbol order by block_number, log_index) as prev
      from oracle_updates
    ),
    changes as (select symbol, session, prev, block_time from t where prev is not null and prev <> session),
    stretches as (
      select c.symbol, c.block_time as closed_at,
        (select min(o.block_time) from changes o where o.symbol = c.symbol and o.prev = 'CLOSED' and o.block_time > c.block_time) as reopened_at
      from changes c where c.session = 'CLOSED'
    ),
    long_ones as (
      select symbol, closed_at, reopened_at from stretches
      where reopened_at is not null and reopened_at - closed_at >= make_interval(hours => ${minHours})
    )
    select l.symbol,
      extract(epoch from (
        select min(u.block_time) from oracle_updates u
        where u.symbol = l.symbol and u.session = 'CLOSED' and u.block_time <= l.closed_at and u.block_time >= l.closed_at - interval '2 hours'
      ))::bigint as first_closed,
      extract(epoch from l.reopened_at)::bigint as reopened
    from long_ones l order by l.closed_at
  `)) as unknown as { symbol: string; first_closed: string; reopened: string }[];
  return rows.map((r) => ({ symbol: r.symbol, firstClosedAt: Number(r.first_closed), reopenedAt: Number(r.reopened) }));
}

/** The latest full depth run (buy and sell rows) for one stock (BE-23). */
export async function latestDepthRun(db: Db, symbol: string) {
  const rows = (await db.execute(sql`
    select kind, size_usd_raw::text as size, price_impact_bps as impact, deviation_bps as deviation, extract(epoch from measured_at)::bigint as at
    from dex_quotes
    where symbol = ${symbol} and kind in ('buy', 'sell') and error is null
      and run_id = (select run_id from dex_quotes where symbol = ${symbol} and kind = 'buy' order by measured_at desc limit 1)
    order by kind, size_usd_raw
  `)) as unknown as { kind: "buy" | "sell"; size: string; impact: number | null; deviation: number | null; at: string }[];
  return rows
    .filter((r) => r.impact !== null && r.deviation !== null)
    .map((r) => ({ direction: r.kind, sizeUsdRaw: r.size, priceImpactBps: r.impact!, deviationBps: r.deviation!, measuredAt: Number(r.at) }));
}

/**
 * DEX mid against the oracle, oldest first, since `sinceSeconds` ago (BE-23). Keeps the last measurement in each
 * `bucketSeconds` window, so a long range stays small.
 */
export async function deviationHistory(db: Db, symbol: string, sinceSeconds: number, bucketSeconds = 1) {
  const rows = (await db.execute(sql`
    select at, oracle, mid, deviation from (
      select distinct on (bucket) at, oracle, mid, deviation from (
        select floor(extract(epoch from measured_at) / ${bucketSeconds}) as bucket, measured_at,
          extract(epoch from measured_at)::bigint as at, oracle_price_e8::text as oracle, mid_price_e8::text as mid, deviation_bps as deviation
        from dex_quotes
        where symbol = ${symbol} and kind = 'mid' and error is null and mid_price_e8 is not null and deviation_bps is not null
          and measured_at >= now() - make_interval(secs => ${sinceSeconds})
      ) q order by bucket, measured_at desc
    ) b order by at
  `)) as unknown as { at: string; oracle: string; mid: string; deviation: number }[];
  return rows.map((r) => ({ timestamp: Number(r.at), oraclePriceE8: r.oracle, dexMidPriceE8: r.mid, deviationBps: r.deviation }));
}

/** Rate snapshots of some markets, oldest first, since `sinceSeconds` ago, the last one per market in each `bucketSeconds` window (BE-23). */
export async function rateHistory(db: Db, marketIds: string[], sinceSeconds: number, bucketSeconds = 1) {
  if (marketIds.length === 0) return [];
  const ids = marketIds.map((m) => m.toLowerCase());
  const rows = (await db.execute(sql`
    select market_id, at, borrow, supply, util from (
      select distinct on (market_id, bucket) market_id, at, borrow, supply, util from (
        select floor(extract(epoch from measured_at) / ${bucketSeconds}) as bucket, measured_at,
          market_id, extract(epoch from measured_at)::bigint as at, borrow_apy_wad::text as borrow, supply_apy_wad::text as supply, utilization_wad::text as util
        from market_rates
        where market_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
          and measured_at >= now() - make_interval(secs => ${sinceSeconds})
      ) q order by market_id, bucket, measured_at desc
    ) b order by at, market_id
  `)) as unknown as { market_id: string; at: string; borrow: string; supply: string; util: string }[];
  return rows.map((r) => ({ marketId: r.market_id, timestamp: Number(r.at), borrowApyWad: r.borrow, supplyApyWad: r.supply, utilizationWad: r.util }));
}

/** Latest DEX mid price (8 decimals) per stock symbol from the depth keeper, when not older than `maxAgeSeconds`. */
export async function latestDexMids(db: Db, maxAgeSeconds: number): Promise<Map<string, bigint>> {
  const rows = (await db.execute(sql`
    select distinct on (symbol) symbol, mid_price_e8::text as mid
    from dex_quotes
    where kind = 'mid' and error is null and mid_price_e8 is not null
      and measured_at >= now() - make_interval(secs => ${maxAgeSeconds})
    order by symbol, measured_at desc
  `)) as unknown as { symbol: string; mid: string }[];
  return new Map(rows.map((r) => [r.symbol, BigInt(r.mid)]));
}
