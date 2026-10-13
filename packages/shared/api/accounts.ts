import { z } from "zod";
import {
  address,
  bytes32,
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
import { gapScenario } from "./quotes";

export const position = z.object({
  marketId: bytes32,
  symbol,
  side: sideName,
  stockAmountRaw: rawAmount,
  collateralRaw: rawAmount,
  debtRaw: rawAmount,
  valueUsdRaw: usdRaw,
  equityUsdRaw: signedUsdRaw,
  entryPriceE8: priceE8,
  oraclePriceE8: priceE8,
  unrealizedPnlUsdRaw: signedUsdRaw,
  ltvWad: wad,
  softLtvWad: wad,
  lltvWad: wad,
  liqPriceE8: priceE8,
  liqDistanceBps: signedBps,
  protection: z.boolean(),
  overSoftLimit: z.boolean(),
  gapScenarios: z.array(gapScenario),
});
export type Position = z.infer<typeof position>;

export const account = z.object({
  address,
  positions: z.array(position),
  totals: z.object({
    equityUsdRaw: signedUsdRaw,
    debtUsdRaw: usdRaw,
    unrealizedPnlUsdRaw: signedUsdRaw,
  }),
  walletBalances: z.array(
    z.object({
      token: address,
      symbol: z.string(),
      balanceRaw: rawAmount,
    }),
  ),
  morphoAuthorized: z.boolean(),
  updatedAtBlock: z.number().int().nonnegative(),
});
export type Account = z.infer<typeof account>;

export const historyItemType = z.enum([
  "open",
  "reduce",
  "close",
  "addCollateral",
  "removeCollateral",
  "repayDebt",
  "borrow",
  "autoReduce",
  "liquidation",
  "lend",
  "withdrawLend",
]);
export type HistoryItemType = z.infer<typeof historyItemType>;

export const historyItem = z.object({
  id: z.string(),
  type: historyItemType,
  marketId: bytes32,
  symbol,
  side: sideName.nullable(),
  txHash: bytes32,
  timestamp: unixSeconds,
  stockAmountRaw: rawAmount.nullable(),
  usdAmountRaw: usdRaw.nullable(),
  execPriceE8: priceE8.nullable(),
  feeRaw: usdRaw.nullable(),
  realizedPnlUsdRaw: signedUsdRaw.nullable(),
});
export type HistoryItem = z.infer<typeof historyItem>;

export const historyQuery = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type HistoryQuery = z.infer<typeof historyQuery>;

export const historyResponse = z.object({
  items: z.array(historyItem),
  nextCursor: z.string().nullable(),
});
export type HistoryResponse = z.infer<typeof historyResponse>;
