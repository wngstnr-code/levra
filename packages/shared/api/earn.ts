import { z } from "zod";
import { address, bytes32, rawAmount, wad } from "./primitives";

export const earnOption = z.object({
  id: z.string(),
  kind: z.enum(["vault", "market"]),
  asset: address,
  assetSymbol: z.string(),
  target: address,
  marketId: bytes32.nullable(),
  supplyApyWad: wad,
  totalSuppliedRaw: rawAmount,
  utilizationWad: wad,
  availableToWithdrawRaw: rawAmount,
  feeWad: wad.nullable(),
});
export type EarnOption = z.infer<typeof earnOption>;

export const earnResponse = z.object({
  options: z.array(earnOption),
});
export type EarnResponse = z.infer<typeof earnResponse>;

export const earnPosition = z.object({
  optionId: z.string(),
  suppliedRaw: rawAmount,
  earnedRaw: rawAmount,
  withdrawableRaw: rawAmount,
});
export type EarnPosition = z.infer<typeof earnPosition>;

export const earnAccount = z.object({
  address,
  positions: z.array(earnPosition),
});
export type EarnAccount = z.infer<typeof earnAccount>;
