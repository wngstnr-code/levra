import { z } from "zod";
import { deployedMarket } from "../deployments";
import { address } from "./primitives";

export const configResponse = z.object({
  chainId: z.number().int().positive(),
  morpho: address,
  usdc: address,
  router: address,
  riskManager: address,
  lens: address,
  markets: z.array(deployedMarket),
});
export type ConfigResponse = z.infer<typeof configResponse>;
