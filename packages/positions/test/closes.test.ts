import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { positionCloses, reductionCloses, type StoredEvent } from "../src";

const LONG: Hex = `0x${"aa".repeat(32)}`;
const SHORT: Hex = `0x${"bb".repeat(32)}`;
const OTHER: Hex = `0x${"cc".repeat(32)}`;
const sideOf = (id: string) => (id === LONG ? "long" : id === SHORT ? "short" : undefined);

let block = 0n;
const ev = (source: StoredEvent["source"], name: string, marketId: Hex, args: StoredEvent["args"]): StoredEvent => {
  block += 1n;
  return { source, name, marketId, txHash: `0x${block.toString(16).padStart(64, "0")}`, logIndex: 1, blockNumber: block, blockTime: Number(block) * 60, args };
};
// USDC 6 decimals, stock 18 decimals.
const open = (marketId: Hex, margin: bigint, collateral: bigint, debt: bigint, fee = 0n) =>
  ev("router", "PositionOpened", marketId, { margin: margin.toString(), collateralDelta: collateral.toString(), debtDelta: debt.toString(), fee: fee.toString(), execPriceE8: "10000000000" });
const reduce = (marketId: Hex, collateral: bigint, debt: bigint, returned: bigint, reason = 0) =>
  ev("router", "PositionReduced", marketId, { collateralDelta: collateral.toString(), debtDelta: debt.toString(), returned: returned.toString(), fee: "0", reason, execPriceE8: "12000000000" });

describe("position closes for receipts (BE-84)", () => {
  it("finds a long's full close with its basis, margin out and realized PnL, and skips a partial reduction", () => {
    const events = [
      open(LONG, 100_000_000n, 3n * 10n ** 18n, 200_000_000n),
      reduce(LONG, 10n ** 18n, 0n, 40_000_000n),
      reduce(LONG, 2n * 10n ** 18n, 0n, 90_000_000n, 1),
    ];
    const closes = positionCloses(events, sideOf);
    expect(closes).toHaveLength(1);
    const c = closes[0]!;
    expect(c).toMatchObject({ marketId: LONG, side: "long", sold: 2n * 10n ** 18n, returned: 90_000_000n, exitPriceE8: 12_000_000_000n, reason: 1, txHash: events[2]!.txHash });
    // A third of the margin left with the first reduction; the close takes the rest.
    expect(c.before.shares).toBe(2n * 10n ** 18n);
    expect(c.marginOut).toBe(66_666_667n);
    expect(c.realized).toBe(90_000_000n - 66_666_667n);
  });

  it("finds a short's close by debt repaid, ignores other markets, and uses Morpho borrow shares when indexed", () => {
    const events = [
      open(SHORT, 50_000_000n, 145_000_000n, 10n ** 18n),
      open(OTHER, 1n, 1n, 1n),
      ev("morpho", "Borrow", SHORT, { shares: "1000" }),
      // The router saw all its stock repaid, but Morpho still shows borrow shares: not a close.
      reduce(SHORT, 0n, 10n ** 18n, 40_000_000n),
      ev("morpho", "Repay", SHORT, { shares: "600" }),
      reduce(OTHER, 1n, 1n, 1n),
    ];
    expect(positionCloses(events, sideOf)).toEqual([]);

    const closing = [...events, ev("morpho", "Repay", SHORT, { shares: "400" }), reduce(SHORT, 0n, 1n, 1_000_000n)];
    // Morpho logs before the router in the same transaction, so shares are zero when the reduction is read.
    const found = positionCloses(closing, sideOf);
    expect(found.map((c) => c.side)).toEqual(["short"]);
  });

  it("decides a close from Morpho shares when known, else from the router's stock", () => {
    const basis = { shares: 10n, buyCost: 0n, invested: 0n, realized: 0n };
    expect(reductionCloses(0n, basis, 1n)).toBe(true);
    expect(reductionCloses(5n, basis, 10n)).toBe(false);
    expect(reductionCloses(undefined, basis, 10n)).toBe(true);
    expect(reductionCloses(undefined, basis, 9n)).toBe(false);
    expect(reductionCloses(undefined, { ...basis, shares: 0n }, 1n)).toBe(false);
  });
});
