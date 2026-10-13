import { BPS, mulDiv, stockForUsd } from "@levra/shared/math";

/**
 * Sizing rules for short quotes (BE-20), kept apart so they can be tested without a chain.
 * Amounts in base units; prices with 8 decimals.
 */

/** A close buys this much more stock than the debt, on top of the slippage room, so the repayment cannot fall short. */
export const CLOSE_SHORT_BUFFER_BPS = 20n;
/** Debt keeps accruing between the quote and the transaction. 1 bps of the debt covers far more than 20 seconds. */
export const DEBT_ACCRUAL_BPS = 1n;
/** First guess of the DEX premium over the oracle price when buying stock back. Corrected from the real route. */
const FIRST_GUESS_PREMIUM_BPS = 200n;

/** Stock to borrow and sell: leverage is the value of the borrowed stock over the margin (04), at the oracle price. */
export function shortBorrowAmount(marginRaw: bigint, leverageE2: number, oraclePriceE8: bigint, quoteDecimals: number, stockDecimals: number): bigint {
  return stockForUsd((marginRaw * BigInt(leverageE2)) / 100n, oraclePriceE8, quoteDecimals, stockDecimals);
}

/** What `openShort` adds as collateral: margin plus sale proceeds, minus the fee on the proceeds. */
export function shortOpenCollateral(marginRaw: bigint, proceedsRaw: bigint, feeBps: bigint): bigint {
  return marginRaw + proceedsRaw - (proceedsRaw * feeBps) / BPS;
}

/** The least stock the close must be sure to receive: the debt it repays plus accrual. */
export function closeShortNeed(debtRepaidRaw: bigint): bigint {
  return debtRepaidRaw + (debtRepaidRaw * DEBT_ACCRUAL_BPS) / BPS + 1n;
}

/** The stock to aim for, so that even the slippage-bound minimum covers the need with the buffer. Rounded up. */
export function closeShortTarget(needRaw: bigint, slippageBps: number): bigint {
  const withBuffer = mulDiv(needRaw, BPS + CLOSE_SHORT_BUFFER_BPS, BPS, "ceil");
  return mulDiv(withBuffer, BPS, BPS - BigInt(slippageBps), "ceil");
}

/** First USDC amount to try for buying `stockRaw`, from the oracle price with a premium. */
export function firstBuyGuess(stockRaw: bigint, oraclePriceE8: bigint, quoteDecimals: number, stockDecimals: number): bigint {
  const atOracle = mulDiv(stockRaw * oraclePriceE8, 10n ** BigInt(quoteDecimals), 100_000_000n * 10n ** BigInt(stockDecimals), "ceil");
  return mulDiv(atOracle, BPS + FIRST_GUESS_PREMIUM_BPS, BPS, "ceil");
}

/** Linear correction of the amount in after a route gave `gotOut` for `amountIn`. */
export function rescaleAmountIn(amountIn: bigint, gotOut: bigint, wantOut: bigint): bigint {
  if (gotOut === 0n) throw new RangeError("The route gave nothing");
  return mulDiv(amountIn, wantOut, gotOut, "ceil");
}

/** What a short close sends back: freed collateral minus the USDC spent buying stock and the fee on it. */
export function closeShortReturned(withdrawRaw: bigint, amountInRaw: bigint, feeBps: bigint): bigint {
  return withdrawRaw - amountInRaw - (amountInRaw * feeBps) / BPS;
}
