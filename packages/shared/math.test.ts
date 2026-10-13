import { describe, expect, it } from "vitest";
import {
  MAX_UINT256,
  WAD,
  borrowApyWad,
  cautiousPriceE8,
  collateralValue,
  deleverageSellValue,
  deviationBps,
  distanceToLiquidationWad,
  liquidationIncentiveFactorWad,
  liquidationPriceE8,
  ltvAfterGapWad,
  maxLeverageE2,
  morphoOraclePrice,
  mulDiv,
  positionLtvWad,
  signedDeviationBps,
  supplyApyWad,
  utilizationWad,
} from "./math";

const pct = (n: number) => (BigInt(Math.round(n * 1e4)) * WAD) / 1_000_000n;
const USDC = 10n ** 6n;
const SHARE = 10n ** 18n;

describe("mulDiv", () => {
  it("rounds down or up", () => {
    expect(mulDiv(10n, 1n, 3n)).toBe(3n);
    expect(mulDiv(10n, 1n, 3n, "ceil")).toBe(4n);
    expect(mulDiv(9n, 1n, 3n, "ceil")).toBe(3n);
  });
});

describe("price used (04)", () => {
  const p = { priceE8: 74_562_000_000n, bidE8: 74_500_000_000n, askE8: 74_600_000_000n };

  it("long takes the lower of price and bid, short the higher of price and ask", () => {
    expect(cautiousPriceE8("long", p)).toBe(74_500_000_000n);
    expect(cautiousPriceE8("short", p)).toBe(74_600_000_000n);
  });

  it("falls back to the price when bid or ask is zero or on the wrong side", () => {
    expect(cautiousPriceE8("long", { ...p, bidE8: 0n })).toBe(p.priceE8);
    expect(cautiousPriceE8("long", { ...p, bidE8: 74_600_000_000n })).toBe(p.priceE8);
    expect(cautiousPriceE8("short", { ...p, askE8: 0n })).toBe(p.priceE8);
    expect(cautiousPriceE8("short", { ...p, askE8: 74_000_000_000n })).toBe(p.priceE8);
  });
});

describe("Morpho price scale (04 required test)", () => {
  it("values one aQQQ share at exactly 745.62 USDC at $745.62", () => {
    const price = morphoOraclePrice("long", 74_562_000_000n, 18, 6);
    expect(price).toBe(74_562_000_000n * 10n ** 16n);
    expect(collateralValue(SHARE, price)).toBe(745_620_000n);
  });

  it("values 745.62 USDC of collateral at one share of stock debt for short", () => {
    const price = morphoOraclePrice("short", 74_562_000_000n, 18, 6);
    expect(price).toBe(10n ** 56n / 74_562_000_000n);
    expect(collateralValue(745_620_000n, price)).toBe(SHARE - 1n);
  });
});

describe("long (04 example)", () => {
  const price = morphoOraclePrice("long", 20_000_000_000n, 18, 6);

  it("margin $100 at 2x: stock $200, debt $100, LTV 50%, distance 35%", () => {
    const ltv = positionLtvWad(100n * USDC, SHARE, price);
    expect(ltv).toBe(pct(50));
    const distance = distanceToLiquidationWad("long", ltv, pct(77));
    expect(Number((distance * 1000n) / WAD)).toBe(350);
  });

  it("liquidation price = debt / (shares × hard limit)", () => {
    const liq = liquidationPriceE8("long", { collateral: SHARE, debt: 100n * USDC, lltvWad: pct(77), stockDecimals: 18, quoteDecimals: 6 });
    expect(liq).toBe(12_987_012_987n);
  });

  it("divides by collateral times the hard limit in one step, as Lens does since PR 13", () => {
    // collateral × lltv is not a whole number of WAD here, so an early rounding would show.
    const p = { collateral: 1_234_567_890_123_456_789n, debt: 543_210_987n, lltvWad: 770_000_000_000_000_001n, stockDecimals: 18, quoteDecimals: 6 };
    const lens = mulDiv(mulDiv(p.debt, 100_000_000n * 10n ** 18n, 10n ** 6n), WAD, p.collateral * p.lltvWad);
    expect(liquidationPriceE8("long", p)).toBe(lens);
  });

  it("LTV after a 10% drop is LTV / 0.9, rounded up", () => {
    expect(ltvAfterGapWad("long", pct(50), -pct(10))).toBe(mulDiv(pct(50), WAD, pct(90), "ceil"));
  });

  it("has no LTV without debt and maximum LTV without collateral value", () => {
    expect(positionLtvWad(0n, SHARE, price)).toBe(0n);
    expect(positionLtvWad(1n, 0n, price)).toBe(MAX_UINT256);
  });
});

describe("short (04 example)", () => {
  it("margin $100, $50 of stock borrowed and sold: LTV 33.3%, distance about 131%", () => {
    const price = morphoOraclePrice("short", 5_000_000_000n, 18, 6);
    const ltv = positionLtvWad(SHARE, 150n * USDC, price);
    expect(ltv).toBe(333_333_333_333_333_334n);
    const distance = distanceToLiquidationWad("short", ltv, pct(77));
    expect(Number((distance * 100n) / WAD)).toBe(130);
  });

  it("liquidation price = collateral × hard limit / shares", () => {
    const liq = liquidationPriceE8("short", { collateral: 150n * USDC, debt: SHARE, lltvWad: pct(77), stockDecimals: 18, quoteDecimals: 6 });
    expect(liq).toBe(11_550_000_000n);
  });
});

describe("maximum leverage (04 table)", () => {
  it.each([
    ["long", 90, 1000],
    ["long", 73, 370],
    ["long", 70, 333],
    ["long", 58, 238],
    ["long", 50, 200],
    ["short", 73, 270],
    ["short", 70, 233],
    ["short", 58, 138],
    ["short", 50, 100],
  ] as const)("%s at a soft limit of %i%% is %i", (side, soft, expected) => {
    expect(maxLeverageE2(side, pct(soft))).toBe(expected);
  });
});

describe("rates", () => {
  it("compounds the per-second borrow rate over a year like Morpho", () => {
    const tenPctLinear = (pct(10) / (365n * 24n * 3600n));
    const apy = borrowApyWad(tenPctLinear);
    expect(apy > pct(10.5) && apy < pct(10.6)).toBe(true);
  });

  it("supply APY = borrow APY × utilization × (1 - fee)", () => {
    expect(utilizationWad(80n, 100n)).toBe(pct(80));
    expect(utilizationWad(1n, 0n)).toBe(0n);
    expect(supplyApyWad(pct(10), pct(80), pct(10))).toBe(pct(7.2));
  });
});

describe("liquidation bonus (04)", () => {
  it.each([
    [77, 7.4],
    [62.5, 12.7],
    [91.5, 2.6],
    [86, 4.4],
  ])("hard limit %d%% gives a bonus of about %d%%", (lltv, bonus) => {
    const lif = liquidationIncentiveFactorWad(pct(lltv));
    expect(Number(((lif - WAD) * 1000n) / WAD) / 10).toBeCloseTo(bonus, 0);
  });

  it("is capped at 15%", () => {
    expect(liquidationIncentiveFactorWad(pct(38.5))).toBe(pct(115));
  });
});

describe("deviation", () => {
  it("matches the contract and keeps the sign for display", () => {
    expect(deviationBps(105_000_000n, 100_000_000n)).toBe(500n);
    expect(signedDeviationBps(97_400_000n, 100_000_000n)).toBe(-260);
  });
});

describe("deleverage size (04)", () => {
  it("sells (D - tV) / ((1 - c) - t)", () => {
    const sell = deleverageSellValue({ debt: 75n * USDC, value: 100n * USDC, targetLtvWad: pct(69), costWad: pct(1) });
    expect(sell).toBe(20_000_000n);
    const after = { debt: 75n * USDC - (sell * 99n) / 100n, value: 100n * USDC - sell };
    expect(positionLtvWad(after.debt, after.value * 10n ** 12n, 10n ** 24n)).toBeLessThanOrEqual(pct(69));
  });

  it("sells nothing when already at or below the target", () => {
    expect(deleverageSellValue({ debt: 50n * USDC, value: 100n * USDC, targetLtvWad: pct(69), costWad: pct(1) })).toBe(0n);
  });
});
