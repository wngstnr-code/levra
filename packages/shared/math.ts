/**
 * Formulas from docs/04-risk-rules.md, in integers only. Each one matches the contracts, including rounding.
 * Units follow docs/03-interfaces.md section 1: prices E8, ratios WAD, token amounts in base units.
 */

export type Side = "long" | "short";

export const WAD = 10n ** 18n;
export const BPS = 10_000n;
/** Morpho prices 1 base unit of collateral in base units of the loan token, times 1e36. */
export const ORACLE_PRICE_SCALE = 10n ** 36n;
export const MAX_UINT256 = 2n ** 256n - 1n;
/** Morpho Blue: LIQUIDATION_CURSOR and MAX_LIQUIDATION_INCENTIVE_FACTOR. */
const LIQUIDATION_CURSOR = 300_000_000_000_000_000n;
const MAX_LIQUIDATION_INCENTIVE_FACTOR = 1_150_000_000_000_000_000n;
const SECONDS_PER_YEAR = 365n * 24n * 3600n;

export function mulDiv(a: bigint, b: bigint, d: bigint, rounding: "floor" | "ceil" = "floor"): bigint {
  if (d === 0n) throw new RangeError("mulDiv by zero");
  const product = a * b;
  const q = product / d;
  return rounding === "ceil" && q * d !== product ? q + 1n : q;
}

const abs = (x: bigint) => (x < 0n ? -x : x);

/** SessionOracle._cautious: long uses the best bid when it is above zero and below the price, short the best ask when it is above the price. */
export function cautiousPriceE8(side: Side, p: { priceE8: bigint; bidE8: bigint; askE8: bigint }): bigint {
  if (p.priceE8 <= 0n) throw new RangeError("Oracle price must be positive");
  if (side === "long") return p.bidE8 > 0n && p.bidE8 < p.priceE8 ? p.bidE8 : p.priceE8;
  return p.askE8 > p.priceE8 ? p.askE8 : p.priceE8;
}

/** SessionOracle.price(): long = p8 × 10^(28 + quoteDecimals - stockDecimals), short = 10^(44 + stockDecimals - quoteDecimals) / p8. */
export function morphoOraclePrice(side: Side, cautiousE8: bigint, stockDecimals: number, quoteDecimals: number): bigint {
  if (side === "long") return cautiousE8 * 10n ** BigInt(28 + quoteDecimals - stockDecimals);
  return 10n ** BigInt(44 + stockDecimals - quoteDecimals) / cautiousE8;
}

/** Value of collateral in loan token base units, rounded down as in Morpho. */
export function collateralValue(collateral: bigint, oraclePrice: bigint): bigint {
  return mulDiv(collateral, oraclePrice, ORACLE_PRICE_SCALE);
}

/** RiskManager.positionLtv: debt over collateral value, rounded up. Zero without debt. */
export function positionLtvWad(debt: bigint, collateral: bigint, oraclePrice: bigint): bigint {
  if (debt === 0n) return 0n;
  const value = collateralValue(collateral, oraclePrice);
  if (value === 0n) return MAX_UINT256;
  return mulDiv(debt, WAD, value, "ceil");
}

/**
 * Lens._liqPriceE8: the cautious stock price (8 decimals) at which the position reaches the hard limit.
 * Long: stock collateral, quote debt. Short: quote collateral, stock debt.
 */
export function liquidationPriceE8(
  side: Side,
  p: { collateral: bigint; debt: bigint; lltvWad: bigint; stockDecimals: number; quoteDecimals: number },
): bigint {
  if (p.debt === 0n || p.collateral === 0n) return 0n;
  const stockUnit = 10n ** BigInt(p.stockDecimals);
  const quoteUnit = 10n ** BigInt(p.quoteDecimals);
  if (side === "long") {
    return mulDiv(mulDiv(p.debt, 100_000_000n * stockUnit, quoteUnit), WAD, ((p.collateral * p.lltvWad) / WAD) * WAD);
  }
  return mulDiv(mulDiv(p.collateral, 100_000_000n * stockUnit, quoteUnit), p.lltvWad, p.debt * WAD);
}

/** How far the price can move against the position before the hard limit, as WAD. Long: fall. Short: rise. */
export function distanceToLiquidationWad(side: Side, ltvWad: bigint, lltvWad: bigint): bigint {
  if (ltvWad === 0n) return MAX_UINT256;
  if (side === "long") return ltvWad >= lltvWad ? 0n : WAD - mulDiv(ltvWad, WAD, lltvWad, "ceil");
  return ltvWad >= lltvWad ? 0n : mulDiv(lltvWad, WAD, ltvWad) - WAD;
}

/** LTV after a price gap g (signed WAD, negative when the price falls). Rounded up, the careful side. */
export function ltvAfterGapWad(side: Side, ltvWad: bigint, gapWad: bigint): bigint {
  if (gapWad <= -WAD) throw new RangeError("A gap of -100% or worse has no meaning");
  if (side === "long") return mulDiv(ltvWad, WAD, WAD + gapWad, "ceil");
  return mulDiv(ltvWad, WAD + gapWad, WAD, "ceil");
}

/** Long: 1 / (1 - soft limit). Short: soft limit / (1 - soft limit). Times 100, rounded down. */
export function maxLeverageE2(side: Side, softLtvWad: bigint): number {
  if (softLtvWad >= WAD) throw new RangeError("Soft limit must be below 100%");
  const numerator = side === "long" ? WAD : softLtvWad;
  return Number(mulDiv(numerator, 100n, WAD - softLtvWad));
}

export function utilizationWad(totalBorrow: bigint, totalSupply: bigint): bigint {
  return totalSupply === 0n ? 0n : mulDiv(totalBorrow, WAD, totalSupply);
}

/** Morpho MathLib.wTaylorCompounded over one year: the borrow APY from the per-second rate. */
export function borrowApyWad(borrowRatePerSecondWad: bigint): bigint {
  const first = borrowRatePerSecondWad * SECONDS_PER_YEAR;
  const second = mulDiv(first, first, 2n * WAD);
  const third = mulDiv(second, first, 3n * WAD);
  return first + second + third;
}

/** Supply APY = borrow APY × utilization × (1 - Morpho market fee). */
export function supplyApyWad(borrowApy: bigint, utilization: bigint, feeWad: bigint): bigint {
  return mulDiv(mulDiv(borrowApy, utilization, WAD), WAD - feeWad, WAD);
}

/** Morpho liquidation incentive factor: min(1.15, 1 / (1 - 0.3 × (1 - lltv))). The bonus is this minus 1. */
export function liquidationIncentiveFactorWad(lltvWad: bigint): bigint {
  const lif = mulDiv(WAD, WAD, WAD - mulDiv(LIQUIDATION_CURSOR, WAD - lltvWad, WAD));
  return lif < MAX_LIQUIDATION_INCENTIVE_FACTOR ? lif : MAX_LIQUIDATION_INCENTIVE_FACTOR;
}

/** MarginRouter._priceE8: dollars per stock token with 8 decimals, from a swap's quote and stock amounts. Zero without stock. */
export function swapPriceE8(quoteAmount: bigint, stockAmount: bigint, quoteDecimals: number, stockDecimals: number): bigint {
  if (stockAmount === 0n) return 0n;
  return mulDiv(quoteAmount * 100_000_000n, 10n ** BigInt(stockDecimals), stockAmount * 10n ** BigInt(quoteDecimals));
}

/** Stock amount worth `usdRaw` (6 decimals) at `priceE8`, rounded down. */
export function stockForUsd(usdRaw: bigint, priceE8: bigint, quoteDecimals: number, stockDecimals: number): bigint {
  return mulDiv(usdRaw * 100_000_000n, 10n ** BigInt(stockDecimals), priceE8 * 10n ** BigInt(quoteDecimals));
}

/** Morpho SharesMathLib: virtual shares and assets that keep share prices sane in empty markets. */
const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;

export const toAssetsUp = (shares: bigint, totalAssets: bigint, totalShares: bigint) =>
  mulDiv(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES, "ceil");
export const toAssetsDown = (shares: bigint, totalAssets: bigint, totalShares: bigint) =>
  mulDiv(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
export const toSharesUp = (assets: bigint, totalAssets: bigint, totalShares: bigint) =>
  mulDiv(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS, "ceil");

export type MorphoPosition = { collateral: bigint; borrowShares: bigint };
export type MorphoTotals = { totalBorrowAssets: bigint; totalBorrowShares: bigint };

/** Morpho._isHealthy: borrowed (rounded up) at most collateral × price / 1e36 × lltv (rounded down). */
export function morphoIsHealthy(p: MorphoPosition, t: MorphoTotals, oraclePrice: bigint, lltvWad: bigint): boolean {
  if (p.borrowShares === 0n) return true;
  const borrowed = toAssetsUp(p.borrowShares, t.totalBorrowAssets, t.totalBorrowShares);
  const maxBorrow = mulDiv(mulDiv(p.collateral, oraclePrice, ORACLE_PRICE_SCALE), lltvWad, WAD);
  return maxBorrow >= borrowed;
}

/** Morpho.liquidate with `seizedAssets` set: the shares and assets the liquidator repays, rounded up as Morpho does. */
export function morphoRepaidForSeize(seized: bigint, t: MorphoTotals, oraclePrice: bigint, lltvWad: bigint) {
  const quoted = mulDiv(seized, oraclePrice, ORACLE_PRICE_SCALE, "ceil");
  const repaidShares = toSharesUp(mulDiv(quoted, WAD, liquidationIncentiveFactorWad(lltvWad), "ceil"), t.totalBorrowAssets, t.totalBorrowShares);
  return { repaidShares, repaidAssets: toAssetsUp(repaidShares, t.totalBorrowAssets, t.totalBorrowShares) };
}

/**
 * The largest collateral seizure Morpho accepts for this position: it may not repay more shares than the borrower has,
 * nor take more collateral than there is. `marginBps` leaves room for interest accrued before the transaction lands.
 */
export function maxSeizable(p: MorphoPosition, t: MorphoTotals, oraclePrice: bigint, lltvWad: bigint, marginBps = 10n): bigint {
  const debt = toAssetsDown(p.borrowShares, t.totalBorrowAssets, t.totalBorrowShares);
  const forDebt = (mulDiv(mulDiv(debt, liquidationIncentiveFactorWad(lltvWad), WAD), ORACLE_PRICE_SCALE, oraclePrice) * (BPS - marginBps)) / BPS;
  const seized = forDebt < p.collateral ? forDebt : p.collateral;
  return seized > 0n && morphoRepaidForSeize(seized, t, oraclePrice, lltvWad).repaidShares > p.borrowShares ? 0n : seized;
}

/** RiskManager.checkOpen: |exec - oracle| × 10,000 / oracle, rounded down. */
export function deviationBps(execPriceE8: bigint, oraclePriceE8: bigint): bigint {
  return mulDiv(abs(execPriceE8 - oraclePriceE8), BPS, oraclePriceE8);
}

/** Signed version for display: positive when the execution price is above the oracle price. */
export function signedDeviationBps(execPriceE8: bigint, oraclePriceE8: bigint): number {
  const magnitude = deviationBps(execPriceE8, oraclePriceE8);
  return Number(execPriceE8 >= oraclePriceE8 ? magnitude : -magnitude);
}

/**
 * Value of stock to sell to bring a long to target LTV t, with selling cost c:
 * (D - t × V) / ((1 - c) - t). D and V in quote base units, t and c as WAD. Rounded up so the target is reached.
 */
export function deleverageSellValue(p: { debt: bigint; value: bigint; targetLtvWad: bigint; costWad: bigint }): bigint {
  const excess = p.debt * WAD - p.targetLtvWad * p.value;
  if (excess <= 0n) return 0n;
  const denominator = WAD - p.costWad - p.targetLtvWad;
  if (denominator <= 0n) throw new RangeError("Target LTV plus selling cost must be below 100%");
  return mulDiv(excess, 1n, denominator, "ceil");
}
