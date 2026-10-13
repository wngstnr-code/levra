import { z } from "zod";
import {
  address,
  bytes32,
  leverageE2,
  priceE8,
  rawAmount,
  sideName,
  signedBps,
  symbol,
  unixSeconds,
  usdRaw,
  wad,
} from "./primitives";
import { sessionInfo } from "./session";

export const market = z.object({
  symbol,
  name: z.string(),
  stockToken: address,
  side: sideName,
  marketId: bytes32,
  collateralToken: address,
  loanToken: address,
  enabled: z.boolean(),

  oraclePriceE8: priceE8,
  oracleFeedUpdatedAt: unixSeconds,
  oraclePublishedAt: unixSeconds,
  oracleStale: z.boolean(),
  dexMidPriceE8: priceE8.nullable(),
  dexDeviationBps: signedBps.nullable(),

  lltvWad: wad,
  softLtvOpenWad: wad,
  softLtvClosedWad: wad,
  currentSoftLtvWad: wad,
  maxLeverageE2: leverageE2,
  maxPositionUsdRaw: usdRaw,

  totalSupplyRaw: rawAmount,
  totalBorrowRaw: rawAmount,
  availableLiquidityRaw: rawAmount,
  utilizationWad: wad,
  borrowApyWad: wad,
  supplyApyWad: wad,
});
export type Market = z.infer<typeof market>;

export const marketsResponse = z.object({
  session: sessionInfo,
  markets: z.array(market),
});
export type MarketsResponse = z.infer<typeof marketsResponse>;

export const depthPoint = z.object({
  direction: z.enum(["buy", "sell"]),
  sizeUsdRaw: usdRaw,
  priceImpactBps: signedBps,
  deviationBps: signedBps,
  measuredAt: unixSeconds,
});
export type DepthPoint = z.infer<typeof depthPoint>;

export const ratePoint = z.object({
  marketId: bytes32,
  timestamp: unixSeconds,
  borrowApyWad: wad,
  supplyApyWad: wad,
  utilizationWad: wad,
});
export type RatePoint = z.infer<typeof ratePoint>;

export const deviationPoint = z.object({
  timestamp: unixSeconds,
  oraclePriceE8: priceE8,
  dexMidPriceE8: priceE8,
  deviationBps: signedBps,
});
export type DeviationPoint = z.infer<typeof deviationPoint>;

export const marketDetail = z.object({
  symbol,
  name: z.string(),
  stockToken: address,
  session: sessionInfo,
  markets: z.array(market),
  depth: z.array(depthPoint),
  rateHistory: z.array(ratePoint),
  deviationHistory: z.array(deviationPoint),
});
export type MarketDetail = z.infer<typeof marketDetail>;
