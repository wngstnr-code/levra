import { mulDiv } from "@levra/shared/math";
import type { Hex } from "viem";
import { costBasis, realizedOnReduce, type CostBasis } from "./cost-basis";
import { toCostEvents, type StoredEvent } from "./events";

/** Change in the owner's borrow shares from one Morpho event, or null when the event does not touch them. */
export function borrowSharesDelta(e: StoredEvent): bigint | null {
  const v = (k: string) => BigInt(String(e.args[k] ?? "0"));
  if (e.name === "Borrow") return v("shares");
  if (e.name === "Repay") return -v("shares");
  if (e.name === "Liquidate") return -(v("repaidShares") + v("badDebtShares"));
  return null;
}

/**
 * Whether a reduction closed the position. With Morpho events indexed, a reduction that leaves no borrow shares closed
 * it, for long and short; without them, one that takes out all the stock the router put in.
 */
export function reductionCloses(sharesAfter: bigint | undefined, before: CostBasis, sold: bigint): boolean {
  return sharesAfter !== undefined ? sharesAfter === 0n : before.shares > 0n && sold >= before.shares;
}

/** A reduction that closed a position, with the basis just before it. Amounts in base units, prices with 8 decimals. */
export type PositionClose = {
  marketId: Hex;
  side: "long" | "short";
  txHash: Hex;
  logIndex: number;
  blockTime: number;
  /** Stock leaving the position: sold collateral for a long, repaid debt for a short. */
  sold: bigint;
  /** USDC (long) or collateral (short) sent back to the user. */
  returned: bigint;
  exitPriceE8: bigint;
  /** `PositionReduced.reason`: 0 by the user, 1 by protection. */
  reason: number;
  before: CostBasis;
  /** Margin the close took out of the basis, and `returned` minus it. */
  marginOut: bigint;
  realized: bigint;
};

/** Every router reduction that closed a position, oldest first. `sideOf` gives the side of our markets, undefined for others. */
export function positionCloses(events: StoredEvent[], sideOf: (marketId: string) => "long" | "short" | undefined): PositionClose[] {
  const closes: PositionClose[] = [];
  const shares = new Map<string, bigint>();
  for (const [i, e] of events.entries()) {
    const marketId = e.marketId.toLowerCase();
    const side = sideOf(marketId);
    if (!side || e.source === "vault") continue;
    if (e.source === "morpho") {
      const delta = borrowSharesDelta(e);
      if (delta !== null) shares.set(marketId, (shares.get(marketId) ?? 0n) + delta);
      continue;
    }
    if (e.name !== "PositionReduced") continue;
    const big = (k: string) => BigInt(String(e.args[k] ?? "0"));
    const before = costBasis(side, toCostEvents(events.slice(0, i)), e.marketId);
    const sold = side === "long" ? big("collateralDelta") : big("debtDelta");
    if (!reductionCloses(shares.get(marketId), before, sold)) continue;
    const part = sold > before.shares ? before.shares : sold;
    const marginOut = before.shares === 0n ? 0n : mulDiv(before.invested, part, before.shares);
    closes.push({
      marketId: e.marketId,
      side,
      txHash: e.txHash,
      logIndex: e.logIndex,
      blockTime: e.blockTime,
      sold,
      returned: big("returned"),
      exitPriceE8: big("execPriceE8"),
      reason: Number(e.args.reason ?? 0),
      before,
      marginOut,
      realized: realizedOnReduce(before, sold, big("returned")),
    });
  }
  return closes;
}
