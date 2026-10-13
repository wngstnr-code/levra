import { z } from "zod";
import {
  address,
  bps,
  bytes32,
  hex,
  leverageE2,
  priceE8,
  rawAmount,
  sideName,
  signedBps,
  signedUsdRaw,
  symbol,
  unixSeconds,
  usdRaw,
  wad,
} from "./primitives";
import { market } from "./markets";

export const warningCode = z.enum([
  "ORACLE_STALE",
  "SESSION_CLOSED",
  "PRE_CLOSE_WINDOW",
  "HIGH_DEVIATION",
  "HIGH_PRICE_IMPACT",
  "NEAR_SOFT_LIMIT",
  "POSITION_CAP",
  "LOW_LIQUIDITY",
]);
export type WarningCode = z.infer<typeof warningCode>;

export const warning = z.object({
  code: warningCode,
  severity: z.enum(["info", "warn", "block"]),
  message: z.string(),
});
export type Warning = z.infer<typeof warning>;

export const gapScenario = z.object({
  label: z.string(),
  moveBps: signedBps,
  ltvWad: wad,
  liquidated: z.boolean(),
});
export type GapScenario = z.infer<typeof gapScenario>;

export const requirementType = z.enum(["approve", "morphoAuthorization"]);

export const requirement = z.object({
  type: requirementType,
  satisfied: z.boolean(),
  token: address.optional(),
  spender: address.optional(),
  amountRaw: rawAmount.optional(),
  typedData: z.unknown().optional(),
});
export type Requirement = z.infer<typeof requirement>;

export const signatureInput = z.object({
  type: requirementType,
  signature: hex,
  deadline: unixSeconds,
  nonce: rawAmount.optional(),
});
export type SignatureInput = z.infer<typeof signatureInput>;

export const txRequest = z.object({
  to: address,
  data: hex,
  value: rawAmount,
  gasLimit: rawAmount,
});
export type TxRequest = z.infer<typeof txRequest>;

export const quoteOpenRequest = z.object({
  user: address,
  symbol,
  side: sideName,
  marginRaw: usdRaw,
  leverageE2,
  slippageBps: bps,
  signatures: z.array(signatureInput).optional(),
});
export type QuoteOpenRequest = z.infer<typeof quoteOpenRequest>;

export const quoteOpenResponse = z.object({
  quoteId: z.string(),
  expiresAt: unixSeconds,
  market,
  preview: z.object({
    stockAmountRaw: rawAmount,
    collateralRaw: rawAmount,
    debtRaw: rawAmount,
    execPriceE8: priceE8,
    oraclePriceE8: priceE8,
    deviationBps: signedBps,
    priceImpactBps: signedBps,
    feeRaw: usdRaw,
    ltvAfterWad: wad,
    liqPriceE8: priceE8,
    liqDistanceBps: signedBps,
    borrowApyWad: wad,
    gapScenarios: z.array(gapScenario),
  }),
  requirements: z.array(requirement),
  tx: txRequest,
  warnings: z.array(warning),
});
export type QuoteOpenResponse = z.infer<typeof quoteOpenResponse>;

export const quoteCloseRequest = z.object({
  user: address,
  marketId: bytes32,
  fractionWad: wad,
  slippageBps: bps,
});
export type QuoteCloseRequest = z.infer<typeof quoteCloseRequest>;

export const quoteCloseResponse = z.object({
  quoteId: z.string(),
  expiresAt: unixSeconds,
  preview: z.object({
    stockAmountRaw: rawAmount,
    debtRepaidRaw: rawAmount,
    collateralWithdrawnRaw: rawAmount,
    returnedRaw: usdRaw,
    execPriceE8: priceE8,
    oraclePriceE8: priceE8,
    deviationBps: signedBps,
    priceImpactBps: signedBps,
    feeRaw: usdRaw,
    ltvAfterWad: wad,
    realizedPnlUsdRaw: signedUsdRaw,
  }),
  requirements: z.array(requirement),
  tx: txRequest,
  warnings: z.array(warning),
});
export type QuoteCloseResponse = z.infer<typeof quoteCloseResponse>;

export const quoteCollateralRequest = z.object({
  user: address,
  marketId: bytes32,
  /** add and remove move collateral; repay pays down debt with the loan token (D-32). */
  action: z.enum(["add", "remove", "repay"]),
  amountRaw: rawAmount,
  signatures: z.array(signatureInput).optional(),
});
export type QuoteCollateralRequest = z.infer<typeof quoteCollateralRequest>;

export const quoteCollateralResponse = z.object({
  quoteId: z.string(),
  expiresAt: unixSeconds,
  preview: z.object({
    collateralAfterRaw: rawAmount,
    ltvAfterWad: wad,
    liqPriceE8: priceE8,
    liqDistanceBps: signedBps,
  }),
  requirements: z.array(requirement),
  tx: txRequest,
  warnings: z.array(warning),
});
export type QuoteCollateralResponse = z.infer<typeof quoteCollateralResponse>;
