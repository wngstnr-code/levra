import type { Market, SessionName } from "@levra/shared/api";
import { stocks, type Stock } from "@levra/shared/markets";

export type OracleSnapshot = { priceE8: bigint; feedUpdatedAt: number; session: SessionName };

export type MarketRow = {
  stock: Stock;
  priceE8: bigint | null;
  feedUpdatedAt: number | null;
  session: SessionName | null;
  stale: boolean;
  deviationBps: number | null;
  long: Market | null;
  short: Market | null;
};

/** Joins the service's markets with direct oracle reads. The service wins when it has an answer. */
export function buildMarketRows(apiMarkets: Market[] | undefined, oracle: Partial<Record<string, OracleSnapshot>>): MarketRow[] {
  return Object.values(stocks).map((stock) => {
    const long = apiMarkets?.find((m) => m.symbol === stock.symbol && m.side === "long") ?? null;
    const short = apiMarkets?.find((m) => m.symbol === stock.symbol && m.side === "short") ?? null;
    const lead = long ?? short;
    const snap = oracle[stock.symbol];
    return {
      stock,
      priceE8: lead ? BigInt(lead.oraclePriceE8) : (snap?.priceE8 ?? null),
      feedUpdatedAt: lead ? lead.oracleFeedUpdatedAt : (snap?.feedUpdatedAt ?? null),
      session: snap?.session ?? null,
      stale: lead?.oracleStale ?? false,
      deviationBps: lead?.dexDeviationBps ?? null,
      long,
      short,
    };
  });
}
