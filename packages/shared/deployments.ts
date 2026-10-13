import { z } from "zod";
import { address, bytes32, sideName, symbol, wad } from "./api/primitives";

export const deployedMarket = z.object({
  symbol,
  side: sideName,
  marketId: bytes32,
  oracle: address,
  collateralToken: address,
  loanToken: address,
  lltv: wad,
});
export type DeployedMarket = z.infer<typeof deployedMarket>;

/** Shape of contracts/deployments/<environment>.json, written by the deployment script. */
export const deployment = z.object({
  chainId: z.number().int().positive(),
  block: z.number().int().nonnegative(),
  router: address,
  riskManager: address,
  lens: address,
  liquidator: address.nullable().optional(),
  usdcVault: address.nullable().optional(),
  markets: z.array(deployedMarket),
});
export type Deployment = z.infer<typeof deployment>;
