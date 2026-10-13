import type { Warning } from "@levra/shared/api";
import { BPS, mulDiv, swapPriceE8 } from "@levra/shared/math";
import { erc20Abi, type Address } from "viem";
import type { ChainReader } from "../chain/reader";
import type { EventStore } from "../positions/events";
import { dexMidPriceE8, type SwapSource } from "@levra/kyber";

/** Initial proposals (04 and 03). */
export const QUOTE_TTL_SECONDS = 20;
export const TX_DEADLINE_SECONDS = 120;
export const PRICE_IMPACT_WARN_BPS = 100;
export const NEAR_SOFT_LIMIT_BPS = 200n;
/**
 * Room on the user's `maxLtv` for interest that accrues on existing debt between the quote and the block. 1 bps of
 * the LTV covers hours of interest at any plausible rate, while still refusing a worse fill.
 */
export const MAX_LTV_ACCRUAL_BPS = 1n;

/** The `maxLtv` to send: the worst-case LTV of the quote plus room for accrued interest, rounded up. */
export const maxLtvWithAccrual = (ltvWorstWad: bigint) => ltvWorstWad + mulDiv(ltvWorstWad, MAX_LTV_ACCRUAL_BPS, BPS, "ceil");

export type QuoteDeps = { reader: ChainReader; swap: SwapSource; events: EventStore };

/** MarginRouter._priceE8, from the shared formulas. */
export const execPriceE8 = swapPriceE8;

export function liqDistanceBps(oraclePriceE8: bigint, liqPriceE8: bigint): number {
  return liqPriceE8 === 0n ? Number(BPS) : Number(((oraclePriceE8 - liqPriceE8) * BPS) / oraclePriceE8);
}

export async function tokenDecimals(reader: ChainReader, tokens: Address[]): Promise<number[]> {
  return Promise.all(tokens.map((address) => reader.client.readContract({ address, abi: erc20Abi, functionName: "decimals" })));
}

/** DEX mid price for the stock: the average of a 10 USDC buy and sell, the same definition the depth table uses. */
export function midPriceE8(swap: SwapSource, quote: Address, stock: Address, quoteDecimals: number, stockDecimals: number, oraclePriceE8: bigint) {
  return dexMidPriceE8(swap, { usdc: quote, stock, usdcDecimals: quoteDecimals, stockDecimals, refPriceE8: oraclePriceE8 });
}

export function warningList() {
  const warnings: Warning[] = [];
  const add = (code: Warning["code"], severity: Warning["severity"], message: string) => warnings.push({ code, severity, message });
  const blocked = () => warnings.some((w) => w.severity === "block");
  return { warnings, add, blocked };
}
