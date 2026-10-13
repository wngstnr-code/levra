import type { Warning } from "@levra/shared/api";
import { BPS, mulDiv } from "@levra/shared/math";
import { erc20Abi, type Address } from "viem";
import type { ChainReader } from "../chain/reader";
import type { SwapSource } from "../swap/kyber";

/** Initial proposals (04 and 03). */
export const QUOTE_TTL_SECONDS = 20;
export const TX_DEADLINE_SECONDS = 120;
export const PRICE_IMPACT_WARN_BPS = 100;
export const NEAR_SOFT_LIMIT_BPS = 200n;
/** Size of the reference swap for the DEX mid price: 10 USDC. */
export const MID_PRICE_PROBE_RAW = 10_000_000n;

export type QuoteDeps = { reader: ChainReader; swap: SwapSource };

/** MarginRouter._priceE8: quote token per stock token as a dollar price with 8 decimals. */
export function execPriceE8(quoteAmount: bigint, stockAmount: bigint, quoteDecimals: number, stockDecimals: number): bigint {
  if (stockAmount === 0n) return 0n;
  return mulDiv(quoteAmount * 100_000_000n, 10n ** BigInt(stockDecimals), stockAmount * 10n ** BigInt(quoteDecimals));
}

export function liqDistanceBps(oraclePriceE8: bigint, liqPriceE8: bigint): number {
  return liqPriceE8 === 0n ? Number(BPS) : Number(((oraclePriceE8 - liqPriceE8) * BPS) / oraclePriceE8);
}

export async function tokenDecimals(reader: ChainReader, tokens: Address[]): Promise<number[]> {
  return Promise.all(tokens.map((address) => reader.client.readContract({ address, abi: erc20Abi, functionName: "decimals" })));
}

/** DEX mid price for the stock, from a 10 USDC buy. */
export async function midPriceE8(swap: SwapSource, quote: Address, stock: Address, quoteDecimals: number, stockDecimals: number) {
  const out = await swap.price({ tokenIn: quote, tokenOut: stock, amountIn: MID_PRICE_PROBE_RAW });
  return execPriceE8(MID_PRICE_PROBE_RAW, out, quoteDecimals, stockDecimals);
}

export function warningList() {
  const warnings: Warning[] = [];
  const add = (code: Warning["code"], severity: Warning["severity"], message: string) => warnings.push({ code, severity, message });
  const blocked = () => warnings.some((w) => w.severity === "block");
  return { warnings, add, blocked };
}
