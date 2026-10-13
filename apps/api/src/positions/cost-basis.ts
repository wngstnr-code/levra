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
 * - Repaying debt with USDC (D-32) is margin added: it raises `invested` and leaves the stock alone.
 * - A liquidation takes the seized stock and returns nothing to the user: the margin behind that stock is lost.
 *
 * Positions changed outside the router (straight on Morpho) are not seen here.
 */
export type CostBasis = { shares: bigint; buyCost: bigint; invested: bigint; realized: bigint };

export const emptyCostBasis = (): CostBasis => ({ shares: 0n, buyCost: 0n, invested: 0n, realized: 0n });

export function longCostBasis(events: RouterEvent[], marketId: Hex): CostBasis {
  const basis = emptyCostBasis();
  for (const e of events) {
    if (e.marketId.toLowerCase() !== marketId.toLowerCase()) continue;
    if (e.kind === "repaid") {
      basis.invested += e.assets;
    } else if (e.kind === "liquidated") {
      reduce(basis, e.seized, 0n);
    } else if (e.kind === "opened") {
      basis.shares += e.collateralDelta;
      basis.buyCost += e.margin + e.debtDelta;
      basis.invested += e.margin;
    } else {
      reduce(basis, e.collateralDelta, e.returned);
    }
  }
  return basis;
}

/**
 * Average-proceeds view of one short position (BE-20), the mirror of `longCostBasis`:
 *
 * - `shares`: stock borrowed and sold through the router, still owed.
 * - `buyCost`: what that stock sold for before the fee, so `entryPriceE8` is the average short price.
 * - `invested`: margin still in the position. A reduction takes out the same share of it as the share of stock it buys back.
 * - `realized`: USDC returned by reductions minus the margin they took out. The bit of extra stock a close buys as a
 *   buffer goes back to the wallet and is not valued here, so realized PnL is slightly on the low side.
 * - A liquidation repays stock and returns nothing: the margin behind that stock is lost.
 * - Stock repaid from the wallet with `repayDebt` is not valued, so it is left out.
 */
export function shortCostBasis(events: RouterEvent[], marketId: Hex): CostBasis {
  const basis = emptyCostBasis();
  for (const e of events) {
    if (e.marketId.toLowerCase() !== marketId.toLowerCase()) continue;
    if (e.kind === "repaid") continue;
    if (e.kind === "liquidated") {
      reduce(basis, e.repaid ?? 0n, 0n);
    } else if (e.kind === "opened") {
      basis.shares += e.debtDelta;
      // collateralDelta is margin + proceeds - fee.
      basis.buyCost += e.collateralDelta - e.margin + e.fee;
      basis.invested += e.margin;
    } else {
      reduce(basis, e.debtDelta, e.returned);
    }
  }
  return basis;
}

export function costBasis(side: "long" | "short", events: RouterEvent[], marketId: Hex): CostBasis {
  return side === "long" ? longCostBasis(events, marketId) : shortCostBasis(events, marketId);
}

/** Takes `soldRaw` stock out of the basis for `returned` USDC to the user, booking the realized PnL. */
function reduce(basis: CostBasis, soldRaw: bigint, returned: bigint) {
  const sold = soldRaw > basis.shares ? basis.shares : soldRaw;
  const removedInvested = basis.shares === 0n ? 0n : mulDiv(basis.invested, sold, basis.shares);
  const removedCost = basis.shares === 0n ? 0n : mulDiv(basis.buyCost, sold, basis.shares);
  basis.realized += returned - removedInvested;
  basis.invested -= removedInvested;
  basis.buyCost -= removedCost;
  basis.shares -= sold;
}

/** Realized PnL of selling `sold` stock for a net `returned` to the user, against the current basis. */
export function realizedOnReduce(basis: CostBasis, sold: bigint, returned: bigint): bigint {
  if (basis.shares === 0n) return 0n;
  const part = sold > basis.shares ? basis.shares : sold;
  return returned - mulDiv(basis.invested, part, basis.shares);
}

/** Average entry price with 8 decimals (buy price for a long, sale price for a short), or zero without router trades. */
export function entryPriceE8(basis: CostBasis, quoteDecimals: number, stockDecimals: number): bigint {
  if (basis.shares === 0n) return 0n;
  return mulDiv(basis.buyCost * 100_000_000n, 10n ** BigInt(stockDecimals), basis.shares * 10n ** BigInt(quoteDecimals));
}
