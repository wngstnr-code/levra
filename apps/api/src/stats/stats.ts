import { marketTrades, morphoPositions, walletCounts, type Db, type EventPosition, type MarketTrades, type TradeNotional } from "@levra/db";
import type { EarnOption, StatsResponse } from "@levra/shared/api";
import { mulDiv, usdForStock } from "@levra/shared/math";
import { createCache } from "../chain/cache";
import type { ChainReader, MarketState } from "../chain/reader";
import { createEarn } from "../earn/earn";

/** Initial proposal: the numbers change slowly, and each refresh reads the whole event history of the chain. */
export const STATS_CACHE_MS = 60_000;

export type StatsInput = {
  chainId: number;
  usdcDecimals: number;
  markets: MarketState[];
  positions: EventPosition[];
  trades: MarketTrades[];
  wallets: StatsResponse["wallets"];
  earnOptions: EarnOption[];
  now: number;
};

/** The stats of one chain (BE-79, D-109) from indexed events and the current market state. */
export function buildStats(input: StatsInput): StatsResponse {
  const { usdcDecimals } = input;
  const byId = new Map(input.markets.map((m) => [m.info.marketId.toLowerCase(), m]));
  const value = (m: MarketState, stock: bigint) => usdForStock(stock, m.oraclePriceE8, usdcDecimals, m.info.stock.decimals);

  const open = input.positions.filter((p) => byId.has(p.marketId.toLowerCase()));
  const collateral = new Map<string, bigint>();
  for (const p of open) collateral.set(p.marketId.toLowerCase(), (collateral.get(p.marketId.toLowerCase()) ?? 0n) + p.collateral);

  let longUsd = 0n;
  let shortUsd = 0n;
  for (const m of input.markets) {
    if (m.info.side === "long") longUsd += value(m, collateral.get(m.info.marketId.toLowerCase()) ?? 0n);
    else shortUsd += value(m, m.totalBorrowRaw);
  }

  // A trade's stock amount is its collateral on a long and its debt on a short; the sums carry the price E8.
  const scale = 100_000_000n;
  const volume = { last24h: 0n, last7d: 0n, total: 0n, trades: 0 };
  for (const t of input.trades) {
    const m = byId.get(t.marketId.toLowerCase());
    if (!m) continue;
    const usd = (n: TradeNotional) =>
      mulDiv(m.info.side === "long" ? n.collateralTimesPrice : n.debtTimesPrice, 10n ** BigInt(usdcDecimals), scale * 10n ** BigInt(m.info.stock.decimals));
    volume.last24h += usd(t.last24h);
    volume.last7d += usd(t.last7d);
    volume.total += usd(t.total);
    volume.trades += t.trades;
  }

  let earnUsd = 0n;
  for (const o of input.earnOptions) {
    if (o.kind === "vault") earnUsd += BigInt(o.totalSuppliedRaw);
    else {
      const m = o.marketId ? byId.get(o.marketId.toLowerCase()) : undefined;
      if (m) earnUsd += value(m, BigInt(o.totalSuppliedRaw));
    }
  }

  return {
    chainId: input.chainId,
    wallets: input.wallets,
    openInterest: { longUsdRaw: longUsd.toString(), shortUsdRaw: shortUsd.toString(), openPositions: open.length },
    volume: { last24hUsdRaw: volume.last24h.toString(), last7dUsdRaw: volume.last7d.toString(), totalUsdRaw: volume.total.toString(), trades: volume.trades },
    earn: { suppliedUsdRaw: earnUsd.toString() },
    updatedAt: input.now,
  };
}

export function createStats(reader: ChainReader, db: Db) {
  const chainId = reader.deployment.chainId;
  const earn = createEarn(reader);
  const vault = reader.deployment.usdcVault;
  const cached = createCache();
  return () =>
    cached("stats", STATS_CACHE_MS, async () => {
      const now = Math.floor(Date.now() / 1000);
      const [markets, positions, trades, wallets, earnOptions] = await Promise.all([
        reader.markets(),
        morphoPositions(db, chainId),
        marketTrades(db, chainId, now),
        walletCounts(db, chainId, vault ? [vault] : []),
        earn.options(),
      ]);
      return buildStats({ chainId, usdcDecimals: reader.usdc.decimals, markets, positions, trades, wallets, earnOptions, now });
    });
}
