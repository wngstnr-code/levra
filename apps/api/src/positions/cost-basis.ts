import { mulDiv } from "@levra/shared/math";
import type { Hex } from "viem";
import type { RouterEvent } from "../chain/reader";

/**
 * Average-cost view of one long position built from router events. Amounts in quote base units, stock in base units.
 *
 * - `invested`: margin still in the position. Opening adds the margin; a reduction removes the same share of it as
 *   the share of stock it sells.
 * - `buyCost` and `shares`: what the stock cost including the fee, for the average entry price.
 * - `realized`: USDC returned by reductions minus the margin they took out.
 *
 * Positions changed outside the router (straight on Morpho) are not seen here.
 */
export type CostBasis = { shares: bigint; buyCost: bigint; invested: bigint; realized: bigint };

export const emptyCostBasis = (): CostBasis => ({ shares: 0n, buyCost: 0n, invested: 0n, realized: 0n });

export function longCostBasis(events: RouterEvent[], marketId: Hex): CostBasis {
  const basis = emptyCostBasis();
  for (const e of events) {
    if (e.marketId.toLowerCase() !== marketId.toLowerCase()) continue;
    if (e.kind === "opened") {
      basis.shares += e.collateralDelta;
      basis.buyCost += e.margin + e.debtDelta;
      basis.invested += e.margin;
    } else {
      const sold = e.collateralDelta > basis.shares ? basis.shares : e.collateralDelta;
      const removedInvested = basis.shares === 0n ? 0n : mulDiv(basis.invested, sold, basis.shares);
      const removedCost = basis.shares === 0n ? 0n : mulDiv(basis.buyCost, sold, basis.shares);
      basis.realized += e.returned - removedInvested;
      basis.invested -= removedInvested;
      basis.buyCost -= removedCost;
      basis.shares -= sold;
    }
  }
  return basis;
}

/** Realized PnL of selling `sold` stock for a net `returned` to the user, against the current basis. */
export function realizedOnReduce(basis: CostBasis, sold: bigint, returned: bigint): bigint {
  if (basis.shares === 0n) return 0n;
  const part = sold > basis.shares ? basis.shares : sold;
  return returned - mulDiv(basis.invested, part, basis.shares);
}

/** Average entry price with 8 decimals, or zero when nothing was bought through the router. */
export function entryPriceE8(basis: CostBasis, quoteDecimals: number, stockDecimals: number): bigint {
  if (basis.shares === 0n) return 0n;
  return mulDiv(basis.buyCost * 100_000_000n, 10n ** BigInt(stockDecimals), basis.shares * 10n ** BigInt(quoteDecimals));
}
