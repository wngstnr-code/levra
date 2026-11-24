import { z } from "zod";
import { address, hex, usdRaw } from "./primitives";

/**
 * USDC in and out of a Levra chain through Circle CCTP V2 (BE-85, D-54), at `/v1/:chainId/bridge/...`. The user's
 * wallet signs every step on the source chain; Circle's Forwarding Service mints on the destination, so the user needs
 * no gas there. The API holds no funds and no keys.
 */
export const bridgeChain = z.object({
  chainId: z.number().int().positive(),
  name: z.string(),
  /** Circle's domain ID. */
  domain: z.number().int().nonnegative(),
  /** Native USDC on that chain, 6 decimals. */
  usdc: address,
  /** A transfer from this chain uses Fast Transfer. Where it does not, Circle's standard transfer is already fast. */
  fast: z.boolean(),
});
export type BridgeChain = z.infer<typeof bridgeChain>;

/** `GET /v1/:chainId/bridge/chains`: the chains USDC can come from and go to. */
export const bridgeChainsResponse = z.object({ chains: z.array(bridgeChain) });
export type BridgeChainsResponse = z.infer<typeof bridgeChainsResponse>;

/** `POST /v1/:chainId/bridge/deposit`: USDC from `fromChainId` into `recipient` on this chain. Region and terms apply. */
export const bridgeDepositRequest = z.object({
  fromChainId: z.number().int().positive(),
  amountRaw: usdRaw,
  recipient: address,
});
export type BridgeDepositRequest = z.infer<typeof bridgeDepositRequest>;

/** `POST /v1/:chainId/bridge/withdraw`: USDC from `user` on this chain to `recipient` on `toChainId`. Never gated. */
export const bridgeWithdrawRequest = z.object({
  toChainId: z.number().int().positive(),
  amountRaw: usdRaw,
  user: address,
  recipient: address,
});
export type BridgeWithdrawRequest = z.infer<typeof bridgeWithdrawRequest>;

export const call = z.object({ to: address, data: hex });
export type Call = z.infer<typeof call>;

/** What the wallet sends on `fromChainId`: `approve` (skip it if the allowance already covers `amountRaw`), then `burn`. */
export const bridgePlan = z.object({
  fromChainId: z.number().int().positive(),
  toChainId: z.number().int().positive(),
  amountRaw: usdRaw,
  /** The most Circle can take: its percentage fee (Fast Transfer) plus the forwarding fee. Taken from the amount. */
  maxFeeRaw: usdRaw,
  /** `amountRaw - maxFeeRaw`; usually a little more arrives. */
  minReceivedRaw: usdRaw,
  finality: z.enum(["fast", "standard"]),
  estimatedSeconds: z.number().int().nonnegative(),
  approve: call.extend({ token: address, spender: address }),
  burn: call,
});
export type BridgePlan = z.infer<typeof bridgePlan>;

/**
 * `GET /v1/bridge/status?fromChainId=&txHash=` for the burn transaction. NOT_FOUND until Circle has seen the burn
 * (keep polling), ATTESTING, MINTING (the Forwarding Service is minting), COMPLETE, or FAILED: forwarding failed and
 * `manualMint` is a call anyone can send on the destination chain; the USDC still goes to the recipient.
 */
export const bridgeStatusQuery = z.object({
  fromChainId: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform(Number),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
export type BridgeStatusQuery = z.infer<typeof bridgeStatusQuery>;

export const bridgeState = z.enum(["NOT_FOUND", "ATTESTING", "MINTING", "COMPLETE", "FAILED"]);
export type BridgeState = z.infer<typeof bridgeState>;

export const bridgeStatusResponse = z.object({
  state: bridgeState,
  fromChainId: z.number().int().positive(),
  toChainId: z.number().int().positive().nullable(),
  txHash: hex,
  amountRaw: usdRaw.nullable(),
  feeRaw: usdRaw.nullable(),
  receivedRaw: usdRaw.nullable(),
  mintTxHash: hex.nullable(),
  /** Circle's reason for holding the attestation, for example `insufficient_fee`. */
  delayReason: z.string().nullable(),
  manualMint: call.nullable(),
});
export type BridgeStatusResponse = z.infer<typeof bridgeStatusResponse>;
