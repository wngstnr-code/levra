import { z } from "zod";
import { chainIds, type ChainId } from "../chains";

/** `GET /v1/chains` (BE-70): the chains the API knows, and which of them it serves now. */
export const chainInfo = z.object({
  chainId: z.number().int().positive(),
  slug: z.enum(["monad", "base", "xlayer"]),
  name: z.string(),
  nativeSymbol: z.string(),
  /** This API has a deployment for the chain and serves its `/v1/:chainId/...` routes. */
  live: z.boolean(),
});
export type ChainInfo = z.infer<typeof chainInfo>;

export const chainsResponse = z.object({
  chains: z.array(chainInfo),
  defaultChainId: z.number().int().positive(),
});
export type ChainsResponse = z.infer<typeof chainsResponse>;

/** The chain ID as it appears in a path: `/v1/8453/markets`. Only the IDs in `chains.ts`. */
export const chainIdParam = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .refine((id): id is ChainId => (chainIds as readonly number[]).includes(id), { message: "unknown chain" });

/** The routes that take a chain ID (03 section 4, BE-70). The path without it serves Monad until the web app moves. */
export const chainRoutes = [
  "config",
  "session",
  "markets",
  "markets/:symbol",
  "markets/:symbol/prices",
  "stream",
  "quote/open",
  "quote/close",
  "quote/collateral",
  "accounts/:address",
  "accounts/:address/history",
  "earn",
  "earn/:address",
  "stats",
  "bridge/chains",
  "bridge/deposit",
  "bridge/withdraw",
  "agent/prepare",
] as const;
export type ChainRoute = (typeof chainRoutes)[number];

/** `chainPath(8453, "markets/:symbol")` is `/v1/8453/markets/:symbol`. */
export const chainPath = (chainId: ChainId, route: ChainRoute) => `/v1/${chainId}/${route}` as const;
