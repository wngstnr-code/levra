import { z } from "zod";
import { address, rawAmount, unixSeconds, usdRaw } from "./primitives";

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
  /**
   * With `includeGas`: a second, small transfer that arrives as MON, since one deposit address delivers one token.
   * The user sends `amountInRaw` of the same token to this address as well.
   */
  gasDeposit: z
    .object({
      id: z.string(),
      depositAddress: z.string(),
      depositMemo: z.string().nullable(),
      amountInRaw: rawAmount,
    })
    .nullable(),
  estimatedSeconds: z.number().int().nonnegative(),
  expiresAt: unixSeconds,
});
export type DepositQuoteResponse = z.infer<typeof depositQuoteResponse>;

export const depositStatus = z.object({
  id: z.string(),
  status: z.enum(["WAITING", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED", "EXPIRED"]),
  originTxHash: z.string().nullable(),
  /** On the destination chain, which is not always an EVM chain for a withdrawal. */
  destinationTxHash: z.string().nullable(),
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
