import { describe, expect, it } from "vitest";
import {
  WAD,
  accrueBorrowAssets,
  maxSeizable,
  morphoIsHealthy,
  morphoOraclePrice,
  morphoRepaidCeiling,
  morphoRepaidForSeize,
  toAssetsUp,
  wTaylorCompounded,
} from "./math";

const SHARE = 10n ** 18n;
const USDC = 10n ** 6n;
const lltv = (77n * WAD) / 100n;
// A market where 1 USDC of debt is 1e6 shares, as in a fresh Morpho market.
const totals = { totalBorrowAssets: 1_000n * USDC, totalBorrowShares: 1_000n * USDC * 1_000_000n };
const price = (dollars: bigint) => morphoOraclePrice("long", dollars * 100_000_000n, 18, 6);

describe("Morpho health", () => {
  const position = { collateral: SHARE, borrowShares: 700n * USDC * 1_000_000n };

  it("is healthy while the debt is within collateral value times the hard limit", () => {
    expect(toAssetsUp(position.borrowShares, totals.totalBorrowAssets, totals.totalBorrowShares)).toBe(700n * USDC);
    expect(morphoIsHealthy(position, totals, price(1_000n), lltv)).toBe(true);
    // At $909 the limit is 699.93 USDC, below the 700 USDC debt.
    expect(morphoIsHealthy(position, totals, price(909n), lltv)).toBe(false);
  });

  it("has nothing to check without debt", () => {
    expect(morphoIsHealthy({ collateral: 0n, borrowShares: 0n }, totals, price(1n), lltv)).toBe(true);
  });
});

describe("liquidation size", () => {
  const position = { collateral: SHARE, borrowShares: 700n * USDC * 1_000_000n };

  it("repays the seized value divided by the incentive factor", () => {
    const { repaidAssets } = morphoRepaidForSeize(SHARE / 2n, totals, price(900n), lltv);
    // $450 of stock at a 7.4% bonus repays about $419.
    expect(repaidAssets > 418n * USDC && repaidAssets < 420n * USDC).toBe(true);
  });

  it("seizes enough to repay the whole debt, never more shares than the borrower has", () => {
    const seized = maxSeizable(position, totals, price(900n), lltv);
    expect(seized < position.collateral).toBe(true);
    const { repaidShares } = morphoRepaidForSeize(seized, totals, price(900n), lltv);
    expect(repaidShares <= position.borrowShares).toBe(true);
    expect(position.borrowShares - repaidShares < position.borrowShares / 500n).toBe(true);
  });

  it("takes all the collateral when it is worth less than the debt (bad debt)", () => {
    expect(maxSeizable(position, totals, price(500n), lltv)).toBe(SHARE);
  });
});

describe("interest accrual (BE-89)", () => {
  // About 100% a year per second, so a minute of interest is visible.
  const rate = WAD / 31_536_000n;

  it("compounds like Morpho's MathLib, to the third term", () => {
    // 1e9 per second for an hour: 3.6e12, plus 6,480,000 and 7 (each term rounded down).
    expect(wTaylorCompounded(1_000_000_000n, 3_600n)).toBe(3_600_006_480_007n);
    expect(accrueBorrowAssets(1_000n * USDC, 1_000_000_000n, 3_600n)).toBe(1_000n * USDC + 3_600n);
    expect(accrueBorrowAssets(1_000n * USDC, rate, 0n)).toBe(1_000n * USDC);
    expect(accrueBorrowAssets(1_000n * USDC, 0n, 3_600n)).toBe(1_000n * USDC);
  });

  it("bounds what Morpho asks back for a seizure, for any interest up to the margin", () => {
    const margin = { ...totals, totalBorrowAssets: accrueBorrowAssets(totals.totalBorrowAssets, rate, 300n) };
    let estimateShort = 0;
    for (let seconds = 0n; seconds <= 300n; seconds += 7n) {
      const landed = { ...totals, totalBorrowAssets: accrueBorrowAssets(totals.totalBorrowAssets, rate, seconds) };
      for (const seized of [SHARE / 2n, SHARE / 3n + 1n, 123_456_789_012_345_678n, 7n * SHARE / 9n]) {
        const actual = morphoRepaidForSeize(seized, landed, price(900n), lltv).repaidAssets;
        const ceiling = morphoRepaidCeiling(seized, margin, price(900n), lltv);
        expect(actual <= ceiling).toBe(true);
        // One share's worth of rounding at most: the ceiling costs nothing real.
        expect(ceiling - actual <= 2n).toBe(true);
        if (actual > morphoRepaidForSeize(seized, totals, price(900n), lltv).repaidAssets) estimateShort += 1;
      }
    }
    // The old sizing from the totals before accrual ends a wei short in some of these cases: the LossTooLarge revert.
    expect(estimateShort).toBeGreaterThan(0);
  });
});
