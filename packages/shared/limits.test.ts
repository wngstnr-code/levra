import { describe, expect, it } from "vitest";
import { gapTable } from "./gaps";
import {
  WAD,
  cautiousPriceE8,
  collateralValue,
  liquidationIncentiveFactorWad,
  liquidationPriceE8,
  ltvAfterGapWad,
  maxLeverageE2,
  morphoOraclePrice,
  positionLtvWad,
  stockForUsd,
  swapPriceE8,
} from "./math";

/**
 * BE-92: every number in 04 "Base limits" (SC-74) and "X Layer limits" (SC-82), recomputed with math.ts. The tables
 * are initial proposals; this test only shows that their numbers follow from the formulas.
 */
const pct = (n: number) => (BigInt(Math.round(n * 100)) * WAD) / 10_000n;
/** WAD as a percentage with two decimals; the tables in 04 round to one. */
const asPct = (wad: bigint) => Number((wad * 10_000n) / WAD) / 100;
const oneDecimal = (e2: number) => Math.round(e2 / 10) / 10;

type Row = { stock: keyof typeof gapTable; hard: number; bonus: number; softOpen: number; softClosed: number };

// 04 "Base limits": soft limits, max leverage open / closed, and the closed check after the worst gap.
const base: (Row & { long: [number, number]; short: [number, number]; afterDrop: number; afterRise: number })[] = [
  { stock: "MSFT", hard: 77, bonus: 7.4, softOpen: 73, softClosed: 70, long: [3.7, 3.3], short: [2.7, 2.3], afterDrop: 73.5, afterRise: 72.2 },
  { stock: "GOOGL", hard: 77, bonus: 7.4, softOpen: 73, softClosed: 70, long: [3.7, 3.3], short: [2.7, 2.3], afterDrop: 75.0, afterRise: 73.7 },
  { stock: "META", hard: 77, bonus: 7.4, softOpen: 72, softClosed: 68, long: [3.6, 3.1], short: [2.6, 2.1], afterDrop: 73.5, afterRise: 72.4 },
  { stock: "AMZN", hard: 77, bonus: 7.4, softOpen: 72, softClosed: 68, long: [3.6, 3.1], short: [2.6, 2.1], afterDrop: 74.1, afterRise: 74.2 },
  { stock: "AAPL", hard: 77, bonus: 7.4, softOpen: 70, softClosed: 66, long: [3.3, 2.9], short: [2.3, 1.9], afterDrop: 72.8, afterRise: 70.4 },
  { stock: "TSLA", hard: 62.5, bonus: 12.7, softOpen: 58, softClosed: 52, long: [2.4, 2.1], short: [1.4, 1.1], afterDrop: 58.3, afterRise: 58.2 },
  { stock: "NVDA", hard: 62.5, bonus: 12.7, softOpen: 58, softClosed: 50, long: [2.4, 2.0], short: [1.4, 1.0], afterDrop: 58.3, afterRise: 52.3 },
  // SPCX: the long check uses NVDA's worst drop (04, too little history of its own).
  { stock: "SPCX", hard: 62.5, bonus: 12.7, softOpen: 55, softClosed: 45, long: [2.2, 1.8], short: [1.2, 0.8], afterDrop: 52.4, afterRise: 48.0 },
];

// 04 "X Layer limits".
const xlayer: (Row & { afterDrop: number; afterRise: number })[] = [
  { stock: "SPY", hard: 77, bonus: 7.4, softOpen: 73, softClosed: 70, afterDrop: 72.9, afterRise: 72.1 },
  { stock: "QQQ", hard: 77, bonus: 7.4, softOpen: 73, softClosed: 70, afterDrop: 74.0, afterRise: 72.7 },
  { stock: "GOOGL", hard: 77, bonus: 7.4, softOpen: 73, softClosed: 70, afterDrop: 75.0, afterRise: 73.7 },
  { stock: "NVDA", hard: 62.5, bonus: 12.7, softOpen: 58, softClosed: 50, afterDrop: 58.3, afterRise: 52.3 },
];

const worstDrop = (stock: keyof typeof gapTable) => gapTable[stock === "SPCX" ? "NVDA" : stock].worstDropBps;
const gapWad = (bps: number) => (BigInt(bps) * WAD) / 10_000n;

function checkRow(row: Row & { afterDrop: number; afterRise: number }) {
  const hard = pct(row.hard);
  expect(Math.round(asPct(liquidationIncentiveFactorWad(hard) - WAD) * 10) / 10, `${row.stock} bonus`).toBe(row.bonus);
  expect(pct(row.softClosed) < pct(row.softOpen) && pct(row.softOpen) < hard, `${row.stock} closed < open < hard`).toBe(true);
  const afterDrop = ltvAfterGapWad("long", pct(row.softClosed), gapWad(worstDrop(row.stock)));
  const afterRise = ltvAfterGapWad("short", pct(row.softClosed), gapWad(gapTable[row.stock].worstRiseBps));
  // Within the rounding of the table (one decimal).
  expect(Math.abs(asPct(afterDrop) - row.afterDrop), `${row.stock} long after the worst drop: ${asPct(afterDrop)}`).toBeLessThanOrEqual(0.06);
  expect(Math.abs(asPct(afterRise) - row.afterRise), `${row.stock} short after the worst rise: ${asPct(afterRise)}`).toBeLessThanOrEqual(0.06);
  expect(afterDrop < hard && afterRise < hard, `${row.stock} closed soft limit survives the worst gap`).toBe(true);
}

describe("04 Base limits (SC-74) follow from math.ts", () => {
  it.each(base)("$stock", (row) => {
    checkRow(row);
    expect([oneDecimal(maxLeverageE2("long", pct(row.softOpen))), oneDecimal(maxLeverageE2("long", pct(row.softClosed)))]).toEqual(row.long);
    expect([oneDecimal(maxLeverageE2("short", pct(row.softOpen))), oneDecimal(maxLeverageE2("short", pct(row.softClosed)))]).toEqual(row.short);
  });
});

describe("04 X Layer limits (SC-82) follow from math.ts", () => {
  it.each(xlayer)("$stock", checkRow);
});

/**
 * Feed answers and Morpho's own oracle for the listed markets, read live on 20 November 2026 (Base block 59829408,
 * X Layer block 76387225). Morpho's oracle equals our long formula for all twelve; two are kept here.
 */
const live = {
  NVDAc: { decimals: 8, answer: 14_359_117_369n, morpho: 1_435_911_736_900_000_000_000_000_000_000_000_000n },
  wQQQx: { decimals: 18, answer: 64_090_272_174n, morpho: 640_902_721_740_000_000_000_000_000n },
} as const;
const USDC = 6;

describe("price scale for 8 decimal (Coinbase) and 18 decimal (xStocks) stocks", () => {
  it.each(Object.entries(live))("%s: the long price equals Morpho's oracle, the short price is its inverse", (_, s) => {
    // ChainlinkSessionOracle reports no bid or ask, so the cautious price is the feed price on both sides.
    expect(cautiousPriceE8("long", { priceE8: s.answer, bidE8: 0n, askE8: 0n })).toBe(s.answer);
    expect(cautiousPriceE8("short", { priceE8: s.answer, bidE8: 0n, askE8: 0n })).toBe(s.answer);
    expect(morphoOraclePrice("long", s.answer, s.decimals, USDC)).toBe(s.morpho);
    // One whole token is worth the feed price in USDC; one USDC buys 1 / price tokens.
    const token = 10n ** BigInt(s.decimals);
    expect(collateralValue(token, morphoOraclePrice("long", s.answer, s.decimals, USDC))).toBe(s.answer / 100n);
    expect(collateralValue(1_000_000n, morphoOraclePrice("short", s.answer, s.decimals, USDC))).toBe((10n ** 8n * token) / s.answer);
  });

  it.each(Object.entries(live))("%s: swap price, stock for USD and the liquidation price agree at this decimal size", (_, s) => {
    const usd = 10_000_000_000n; // $10,000
    const stock = stockForUsd(usd, s.answer, USDC, s.decimals);
    // Rounded down when buying, so the price read back is at most one unit of the stock off.
    expect(swapPriceE8(usd, stock, USDC, s.decimals) - s.answer).toBeLessThanOrEqual(s.answer / stock + 1n);
    expect(swapPriceE8(usd, stock, USDC, s.decimals) >= s.answer).toBe(true);

    const lltv = pct(62.5);
    // Long: $10,000 of stock with $5,000 of debt reaches the hard limit at 0.5 / 0.625 = 80% of the price.
    const longLiq = liquidationPriceE8("long", { collateral: stock, debt: usd / 2n, lltvWad: lltv, stockDecimals: s.decimals, quoteDecimals: USDC });
    expect(Number(longLiq) / Number(s.answer)).toBeCloseTo(0.8, 6);
    expect(positionLtvWad(usd / 2n, stock, morphoOraclePrice("long", longLiq, s.decimals, USDC))).toBeLessThanOrEqual(lltv + 10n ** 12n);
    // Short: $10,000 of USDC with $5,000 of borrowed stock reaches it at 0.625 / 0.5 = 125% of the price.
    const borrowed = stockForUsd(usd / 2n, s.answer, USDC, s.decimals);
    const shortLiq = liquidationPriceE8("short", { collateral: usd, debt: borrowed, lltvWad: lltv, stockDecimals: s.decimals, quoteDecimals: USDC });
    expect(Number(shortLiq) / Number(s.answer)).toBeCloseTo(1.25, 6);
    expect(positionLtvWad(borrowed, usd, morphoOraclePrice("short", shortLiq, s.decimals, USDC))).toBeLessThanOrEqual(lltv + 10n ** 12n);
  });
});
