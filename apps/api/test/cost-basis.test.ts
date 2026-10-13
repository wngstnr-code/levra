import { describe, expect, it } from "vitest";
import type { RouterEvent } from "../src/chain/reader";
import { entryPriceE8, longCostBasis, realizedOnReduce } from "../src/positions/cost-basis";

const market = `0x${"aa".repeat(32)}` as const;
const other = `0x${"bb".repeat(32)}` as const;
const USDC = 1_000_000n;
const SHARE = 10n ** 18n;

const opened = (margin: bigint, debt: bigint, shares: bigint, marketId: `0x${string}` = market): RouterEvent => ({
  kind: "opened",
  marketId,
  block: 1n,
  logIndex: 0,
  margin,
  collateralDelta: shares,
  debtDelta: debt,
  fee: 0n,
});
const reduced = (shares: bigint, debt: bigint, returned: bigint): RouterEvent => ({
  kind: "reduced",
  marketId: market,
  block: 2n,
  logIndex: 0,
  collateralDelta: shares,
  debtDelta: debt,
  returned,
  fee: 0n,
  reason: 0,
});

describe("long cost basis", () => {
  it("averages the entry over two buys and ignores other markets", () => {
    const basis = longCostBasis([opened(100n * USDC, 100n * USDC, SHARE / 4n), opened(100n * USDC, 100n * USDC, SHARE / 4n), opened(5n * USDC, 0n, SHARE, other)], market);
    expect(basis).toMatchObject({ shares: SHARE / 2n, buyCost: 400n * USDC, invested: 200n * USDC, realized: 0n });
    expect(entryPriceE8(basis, 6, 18)).toBe(80_000_000_000n);
  });

  it("realizes the returned USDC minus the share of margin taken out", () => {
    const start = longCostBasis([opened(100n * USDC, 100n * USDC, SHARE / 4n)], market);
    expect(realizedOnReduce(start, SHARE / 8n, 70n * USDC)).toBe(20n * USDC);

    const after = longCostBasis([opened(100n * USDC, 100n * USDC, SHARE / 4n), reduced(SHARE / 8n, 50n * USDC, 70n * USDC)], market);
    expect(after).toMatchObject({ shares: SHARE / 8n, invested: 50n * USDC, realized: 20n * USDC });
    expect(entryPriceE8(after, 6, 18)).toBe(80_000_000_000n);
  });

  it("has no basis for a position opened outside the router", () => {
    expect(realizedOnReduce(longCostBasis([], market), SHARE, 10n * USDC)).toBe(0n);
  });
});
