import { z } from "zod";
import { address, bytes32, rawAmount, unixSeconds, usdRaw } from "./primitives";

export const depositToken = z.object({
  chain: z.string(),
  chainName: z.string(),
  token: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
  minAmountRaw: rawAmount.nullable(),
});
export type DepositToken = z.infer<typeof depositToken>;

export const depositTokensResponse = z.object({
  tokens: z.array(depositToken),
});
export type DepositTokensResponse = z.infer<typeof depositTokensResponse>;

export const depositQuoteRequest = z.object({
  recipient: address,
  originChain: z.string(),
  originToken: z.string(),
  amountRaw: rawAmount,
  refundAddress: z.string().min(1),
  includeGas: z.boolean(),
});
export type DepositQuoteRequest = z.infer<typeof depositQuoteRequest>;

export const depositQuoteResponse = z.object({
  id: z.string(),
  depositAddress: z.string(),
  depositMemo: z.string().nullable(),
  amountOutRaw: usdRaw,
  gasOutRaw: rawAmount.nullable(),
  estimatedSeconds: z.number().int().nonnegative(),
  expiresAt: unixSeconds,
});
export type DepositQuoteResponse = z.infer<typeof depositQuoteResponse>;

export const depositStatus = z.object({
  id: z.string(),
  status: z.enum(["WAITING", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED", "EXPIRED"]),
  originTxHash: z.string().nullable(),
  destinationTxHash: bytes32.nullable(),
  amountOutRaw: usdRaw.nullable(),
  updatedAt: unixSeconds,
});
export type DepositStatus = z.infer<typeof depositStatus>;

export const withdrawQuoteRequest = z.object({
  user: address,
  destinationChain: z.string(),
  destinationToken: z.string(),
  amountRaw: usdRaw,
  recipient: z.string().min(1),
});
export type WithdrawQuoteRequest = z.infer<typeof withdrawQuoteRequest>;

export const withdrawQuoteResponse = z.object({
  id: z.string(),
  depositAddress: address,
  amountOutRaw: rawAmount,
  estimatedSeconds: z.number().int().nonnegative(),
  expiresAt: unixSeconds,
});
export type WithdrawQuoteResponse = z.infer<typeof withdrawQuoteResponse>;
