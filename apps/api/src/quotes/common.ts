import type { Warning } from "@levra/shared/api";
import { BPS, mulDiv, swapPriceE8 } from "@levra/shared/math";
import { erc20Abi, type Address } from "viem";
import { createCache, type Cached } from "../chain/cache";
import type { ChainReader, MarketState } from "../chain/reader";
import { ApiHttpError, upstream } from "../errors";
import type { EventStore } from "../positions/events";
import { SwapError, dexMidPriceE8, type SwapSource } from "@levra/swap";

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
  return liqPriceE8 === 0n || oraclePriceE8 === 0n ? Number(BPS) : Number(((oraclePriceE8 - liqPriceE8) * BPS) / oraclePriceE8);
}

/** Lens reports price 0 when the oracle's `snapshot()` reverts: a non-positive or missing price (BE-99). */
export const hasNoPrice = (m: MarketState) => m.oraclePriceE8 === 0n;

/** Opening needs a price at every step: RiskManager checks the fill and the LTV against it. */
export function requirePrice(m: MarketState): void {
  if (hasNoPrice(m)) throw new ApiHttpError("BAD_REQUEST", "The oracle has no price for this market right now, so a position cannot be opened.", { oraclePriceE8: "0" });
}

/**
 * Without a price only a full close works, and only through a router with SC-86: it ends with no debt, so neither the
 * router nor Morpho reads the oracle. A partial close or a withdrawal that leaves debt needs the price and would revert.
 */
export async function requireCloseWithoutPrice(reader: ChainReader, m: MarketState, full: boolean): Promise<void> {
  if (!hasNoPrice(m)) return;
  if (!full) throw new ApiHttpError("BAD_REQUEST", "The oracle has no price for this market right now. Only a full close works until it is back.", { oraclePriceE8: "0" });
  if (!(await upstream(reader.closesWithoutPrice))) {
    throw new ApiHttpError("BAD_REQUEST", "The oracle has no price for this market right now, and the router on this chain needs one to close. Try again when it is back.", { oraclePriceE8: "0" });
  }
}

/**
 * A stand-in price from the DEX alone, for sizing when the oracle has none: what selling `stockAmount` would bring,
 * as a price with 8 decimals.
 */
export async function dexRefPriceE8(swap: SwapSource, p: { quote: Address; stock: Address; stockAmount: bigint; quoteDecimals: number; stockDecimals: number }): Promise<bigint> {
  const out = await swap.price({ tokenIn: p.stock, tokenOut: p.quote, amountIn: p.stockAmount });
  if (out === 0n) throw new SwapError("NO_ROUTE", "The DEX gives no price for this stock right now.");
  return swapPriceE8(out, p.stockAmount, p.quoteDecimals, p.stockDecimals);
}

export const NO_PRICE_WARNING = "The oracle has no price, so this full close is priced by the DEX alone. Check what you get back before you sign.";

export async function tokenDecimals(reader: ChainReader, tokens: Address[]): Promise<number[]> {
  return Promise.all(tokens.map((address) => reader.client.readContract({ address, abi: erc20Abi, functionName: "decimals" })));
}

/**
 * Each mid price costs two KyberSwap calls, as much as the route itself, so one measurement per stock is shared by
 * every quote for a minute. It only feeds the price impact shown and its warning; the fill is bounded by the route
 * and the contract. Initial proposal.
 */
export const MID_PRICE_CACHE_MS = 60_000;
const midCaches = new WeakMap<SwapSource, Cached>();

/** DEX mid price for the stock: the average of a 10 USDC buy and sell, the same definition the depth table uses. */
export function midPriceE8(swap: SwapSource, quote: Address, stock: Address, quoteDecimals: number, stockDecimals: number, oraclePriceE8: bigint) {
  let cached = midCaches.get(swap);
  if (!cached) midCaches.set(swap, (cached = createCache()));
  return cached(`mid:${stock.toLowerCase()}`, MID_PRICE_CACHE_MS, () =>
    dexMidPriceE8(swap, { usdc: quote, stock, usdcDecimals: quoteDecimals, stockDecimals, refPriceE8: oraclePriceE8 }),
  );
}

export function warningList() {
  const warnings: Warning[] = [];
  const add = (code: Warning["code"], severity: Warning["severity"], message: string) => warnings.push({ code, severity, message });
  const blocked = () => warnings.some((w) => w.severity === "block");
  return { warnings, add, blocked };
}
