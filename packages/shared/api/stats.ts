import { z } from "zod";
import { unixSeconds, usdRaw } from "./primitives";

const count = z.number().int().nonnegative();

/**
 * `GET /v1/:chainId/stats` (BE-79): public numbers of one chain for the stats page (FE-75). Definitions in 03 and D-109.
 * Dollar amounts are USDC base units (6 decimals), stock valued at the oracle price.
 */
export const statsResponse = z.object({
  chainId: z.number().int().positive(),
  wallets: z.object({
    /** Wallets that traded or lent at least once. */
    total: count,
    /** Wallets that opened a position through the router. */
    traders: count,
    /** Wallets that deposited in the USDC vault or supplied stock to a short market. */
    lenders: count,
  }),
  openInterest: z.object({
    /** Stock held as collateral in the long markets. */
    longUsdRaw: usdRaw,
    /** Stock borrowed in the short markets, interest included. */
    shortUsdRaw: usdRaw,
    /** Morpho positions with collateral or debt in our markets. */
    openPositions: count,
  }),
  volume: z.object({
    /** Stock bought or sold by router trades (opens and reductions, automatic ones included), at each trade's price. */
    last24hUsdRaw: usdRaw,
    last7dUsdRaw: usdRaw,
    totalUsdRaw: usdRaw,
    trades: count,
  }),
  earn: z.object({
    /** USDC in the vault plus stock supplied to the short markets. */
    suppliedUsdRaw: usdRaw,
  }),
  updatedAt: unixSeconds,
});
export type StatsResponse = z.infer<typeof statsResponse>;
