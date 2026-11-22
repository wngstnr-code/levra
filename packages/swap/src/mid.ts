import type { Address } from "viem";
import { SwapError, type SwapSource } from "./types";

/** Size of the two probes behind the DEX mid price: 10 USDC each way. */
export const MID_PROBE_USD_RAW = 10_000_000n;

/**
 * DEX mid price with 8 decimals: the average of a 10 USDC buy and a sell of the stock worth 10 USDC at `refPriceE8`.
 * One-sided probes carry the pool fee and half the spread, so their average is the fair middle.
 */
export async function dexMidPriceE8(
  swap: SwapSource,
  p: { usdc: Address; stock: Address; usdcDecimals: number; stockDecimals: number; refPriceE8: bigint },
): Promise<bigint> {
  const usdcUnit = 10n ** BigInt(p.usdcDecimals);
  const stockUnit = 10n ** BigInt(p.stockDecimals);
  const sellAmount = (MID_PROBE_USD_RAW * 100_000_000n * stockUnit) / (p.refPriceE8 * usdcUnit);
  const [bought, sold] = await Promise.all([
    swap.price({ tokenIn: p.usdc, tokenOut: p.stock, amountIn: MID_PROBE_USD_RAW }),
    swap.price({ tokenIn: p.stock, tokenOut: p.usdc, amountIn: sellAmount }),
  ]);
  if (bought === 0n || sellAmount === 0n) throw new SwapError("NO_ROUTE", "The DEX gave nothing for the mid price probe.");
  const buyPrice = (MID_PROBE_USD_RAW * 100_000_000n * stockUnit) / (bought * usdcUnit);
  const sellPrice = (sold * 100_000_000n * stockUnit) / (sellAmount * usdcUnit);
  return (buyPrice + sellPrice) / 2n;
}
