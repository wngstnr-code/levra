import { externalByChain, tokensByChain } from "@levra/shared/addresses";
import { deviationHistory, latestDepthRun, latestOraclePrice, oraclePriceSeries, rateHistory, type Db } from "@levra/db";
import {
  priceHistoryQuery,
  type ConfigResponse,
  type DepthPoint,
  type DeviationPoint,
  type Market,
  type MarketDetail,
  type MarketsResponse,
  type PriceHistoryResponse,
  type PricePoint,
  type PriceRange,
  type RatePoint,
  type SessionInfo,
} from "@levra/shared/api";
import { isChainId } from "@levra/shared/chains";
import { findStock } from "@levra/shared/markets";
import { borrowApyWad, maxLeverageE2, signedDeviationBps, supplyApyWad, utilizationWad } from "@levra/shared/math";
import { Hono } from "hono";
import { createCache } from "../chain/cache";
import type { ChainReader, ChainSession, MarketState } from "../chain/reader";
import { ApiHttpError, upstream } from "../errors";

/**
 * `dexMidE8` comes from the depth keeper (BE-04); without a recent measurement the DEX fields stay null. `haltReasons`
 * come from the team monitor (BE-75).
 */
export function toApiMarket(m: MarketState, dexMidE8?: bigint, haltReasons: string[] = []): Market {
  const utilization = utilizationWad(m.totalBorrowRaw, m.totalSupplyRaw);
  const borrowApy = borrowApyWad(m.borrowRatePerSecondWad);
  const available = m.totalSupplyRaw > m.totalBorrowRaw ? m.totalSupplyRaw - m.totalBorrowRaw : 0n;
  return {
    symbol: m.info.symbol,
    name: m.info.stock.name,
    stockToken: m.info.stock.token,
    side: m.info.side,
    marketId: m.info.marketId,
    collateralToken: m.info.collateralToken,
    loanToken: m.info.loanToken,
    enabled: m.enabled,
    oraclePriceE8: m.oraclePriceE8.toString(),
    oracleFeedUpdatedAt: m.feedUpdatedAt,
    oraclePublishedAt: m.publishedAt,
    oracleStale: m.oracleStale,
    dexMidPriceE8: dexMidE8 === undefined ? null : dexMidE8.toString(),
    dexDeviationBps: dexMidE8 === undefined || m.oraclePriceE8 === 0n ? null : signedDeviationBps(dexMidE8, m.oraclePriceE8),
    lltvWad: m.lltvWad.toString(),
    softLtvOpenWad: m.softLtvOpenWad.toString(),
    softLtvClosedWad: m.softLtvClosedWad.toString(),
    currentSoftLtvWad: m.currentSoftLtvWad.toString(),
    maxLeverageE2: maxLeverageE2(m.info.side, m.currentSoftLtvWad),
    maxPositionUsdRaw: m.maxPositionUsdRaw.toString(),
    totalSupplyRaw: m.totalSupplyRaw.toString(),
    totalBorrowRaw: m.totalBorrowRaw.toString(),
    availableLiquidityRaw: available.toString(),
    utilizationWad: utilization.toString(),
    borrowApyWad: borrowApy.toString(),
    supplyApyWad: supplyApyWad(borrowApy, utilization, m.morphoFeeWad).toString(),
    oracleKind: "priceFeed" in m.info.stock ? "chainlink" : "anchored",
    uiMultiplierWad: m.uiMultiplierWad === null ? null : m.uiMultiplierWad.toString(),
    tokenPaused: m.tokenPaused,
    haltReasons,
  };
}

/** Active issuer blocks on the chain (BE-75): `symbol` null covers every market. */
export type Halts = () => Promise<{ symbol: string | null; message: string }[]>;
export const noHalts: Halts = async () => [];

export function haltReasonsFor(halts: { symbol: string | null; message: string }[], symbol: string): string[] {
  return halts.filter((h) => h.symbol === null || h.symbol === symbol).map((h) => h.message);
}

export function toSessionInfo(s: ChainSession): SessionInfo {
  return {
    session: s.session,
    closedRegime: s.closedRegime,
    nextCloseAt: s.nextCloseAt,
    // Comes from the exchange calendar (BE-30). The chain does not know the next open.
    nextOpenAt: null,
    updatedAt: s.blockTime,
  };
}

/** DEX mid prices per stock symbol. Empty when there is no recent measurement. */
export type DexMids = () => Promise<Map<string, bigint>>;
export const noDexMids: DexMids = async () => new Map();

/** Measured history for the market detail (BE-23) and the price chart (BE-24). Empty without a database. */
export type MarketHistory = {
  depth(symbol: string): Promise<DepthPoint[]>;
  rates(marketIds: string[]): Promise<RatePoint[]>;
  deviation(symbol: string): Promise<DeviationPoint[]>;
  /** Oracle prices over `range` up to `nowSeconds`, oldest first. */
  prices(symbol: string, range: PriceRange, nowSeconds: number): Promise<PricePoint[]>;
};
export const noMarketHistory: MarketHistory = { depth: async () => [], rates: async () => [], deviation: async () => [], prices: async () => [] };

/** 30 days, one point per hour. Initial proposal: enough for a chart, small enough for one response. */
const HISTORY_SECONDS = 30 * 86_400;
const HISTORY_BUCKET_SECONDS = 3_600;

/** Window and point spacing of each price chart range. Initial proposal: 288, 168 and 180 points. */
export const PRICE_RANGES: Record<PriceRange, { seconds: number; bucketSeconds: number }> = {
  "1D": { seconds: 86_400, bucketSeconds: 300 },
  "1W": { seconds: 7 * 86_400, bucketSeconds: 3_600 },
  "1M": { seconds: 30 * 86_400, bucketSeconds: 14_400 },
};

/** Bucket times inside the window: multiples of the spacing (UTC), from the first after the start to the last before now. */
export function priceBuckets(range: PriceRange, nowSeconds: number): { from: number; to: number; bucketSeconds: number } {
  const { seconds, bucketSeconds } = PRICE_RANGES[range];
  return {
    from: Math.ceil((nowSeconds - seconds) / bucketSeconds) * bucketSeconds,
    to: Math.floor(nowSeconds / bucketSeconds) * bucketSeconds,
    bucketSeconds,
  };
}

/** Ends the series with the latest recorded price at `nowSeconds`, so the chart reaches the present. */
export function withLatestPrice(series: PricePoint[], latest: PricePoint | null, nowSeconds: number): PricePoint[] {
  if (!latest || latest.timestamp > nowSeconds) return series;
  const last = series.at(-1);
  if (last && last.timestamp >= nowSeconds) return series;
  return [...series, { timestamp: nowSeconds, oraclePriceE8: latest.oraclePriceE8 }];
}

export function dbMarketHistory(db: Db, chainId: number): MarketHistory {
  return {
    depth: (symbol) => latestDepthRun(db, chainId, symbol),
    rates: async (marketIds) => (await rateHistory(db, chainId, marketIds, HISTORY_SECONDS, HISTORY_BUCKET_SECONDS)).map((r) => ({ ...r, marketId: r.marketId as `0x${string}` })),
    deviation: (symbol) => deviationHistory(db, chainId, symbol, HISTORY_SECONDS, HISTORY_BUCKET_SECONDS),
    prices: async (symbol, range, nowSeconds) => {
      const { from, to, bucketSeconds } = priceBuckets(range, nowSeconds);
      const [series, latest] = await Promise.all([oraclePriceSeries(db, chainId, symbol, from, to, bucketSeconds), latestOraclePrice(db, chainId, symbol)]);
      return withLatestPrice(series, latest, nowSeconds);
    },
  };
}

/** Each chart is shared by every viewer for a few seconds; the stream carries the live price in between. */
const PRICE_CACHE_MS = 10_000;

export function marketRoutes(
  reader: ChainReader,
  dexMids: DexMids = noDexMids,
  history: MarketHistory = noMarketHistory,
  now: () => number = Date.now,
  halts: Halts = noHalts,
) {
  const app = new Hono();
  const { deployment } = reader;
  const chainId = deployment.chainId;
  if (!isChainId(chainId)) throw new Error(`Deployment is for chain ${chainId}, which has no addresses in packages/shared`);

  app.get("/v1/config", (c) =>
    c.json({
      chainId: deployment.chainId,
      morpho: externalByChain[chainId].morpho,
      usdc: tokensByChain[chainId].USDC.address,
      router: deployment.router,
      riskManager: deployment.riskManager,
      lens: deployment.lens,
      markets: deployment.markets,
    } satisfies ConfigResponse),
  );

  app.get("/v1/session", async (c) => c.json(toSessionInfo(await upstream(reader.session))));

  app.get("/v1/markets", async (c) => {
    const [session, markets, mids, blocks] = await Promise.all([upstream(reader.session), upstream(reader.markets), dexMids(), halts()]);
    return c.json({
      session: toSessionInfo(session),
      markets: markets.map((m) => toApiMarket(m, mids.get(m.info.symbol), haltReasonsFor(blocks, m.info.symbol))),
    } satisfies MarketsResponse);
  });

  app.get("/v1/markets/:symbol", async (c) => {
    const symbol = c.req.param("symbol").toUpperCase();
    const stock = findStock(chainId, symbol);
    if (!stock) throw new ApiHttpError("NOT_FOUND", `No stock ${symbol}.`);
    const [session, markets, mids, blocks] = await Promise.all([upstream(reader.session), upstream(reader.markets), dexMids(), halts()]);
    const own = markets.filter((m) => m.info.symbol === symbol);
    if (own.length === 0) throw new ApiHttpError("NOT_FOUND", `No market for ${symbol} in this deployment.`);
    const [depth, rateHistory, deviationHistory] = await Promise.all([
      upstream(() => history.depth(symbol)),
      upstream(() => history.rates(own.map((m) => m.info.marketId))),
      upstream(() => history.deviation(symbol)),
    ]);
    return c.json({
      symbol,
      name: stock.name,
      stockToken: stock.token,
      session: toSessionInfo(session),
      markets: own.map((m) => toApiMarket(m, mids.get(symbol), haltReasonsFor(blocks, symbol))),
      depth,
      rateHistory,
      deviationHistory,
    } satisfies MarketDetail);
  });

  const cachedPrices = createCache(now);
  app.get("/v1/markets/:symbol/prices", async (c) => {
    const symbol = c.req.param("symbol").toUpperCase();
    if (!findStock(chainId, symbol) || !deployment.markets.some((m) => m.symbol === symbol)) {
      throw new ApiHttpError("NOT_FOUND", `No market for ${symbol} in this deployment.`);
    }
    const parsed = priceHistoryQuery.safeParse({ range: c.req.query("range") });
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "range must be 1D, 1W or 1M.");
    const { range } = parsed.data;
    const points = await cachedPrices(`${symbol}:${range}`, PRICE_CACHE_MS, () =>
      upstream(() => history.prices(symbol, range, Math.floor(now() / 1000))),
    );
    return c.json({ symbol, range, points } satisfies PriceHistoryResponse);
  });

  return app;
}
