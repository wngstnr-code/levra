import { externalByChain } from "@levra/shared/addresses";
import type { ChainId } from "@levra/shared/chains";
import { bestRoute, createAero, createKyber, createOkx, createUniswapV3, KYBER_BASE_URL, KYBER_MONAD_URL, routeForRouter, type SwapProvider, type SwapSource } from "@levra/swap";
import type { Address, PublicClient } from "viem";

export type DepthSwapKeys = {
  kyberMonadUrl?: string;
  kyberClientId: string;
  kyberApiKey?: string;
  /** Without it X Layer is measured on Uniswap only, which has no pool for wNVDAx and wSPYx (05). */
  okx?: { apiKey: string; secretKey: string; passphrase: string };
};

/**
 * Milliseconds between two OKX requests of the keeper. The key is shared with the API's quotes, so the daily depth
 * table (about 50 requests) is spread over a few minutes. Initial proposal; OKX's limit for our key is not verified.
 */
export const KEEPER_OKX_GAP_MS = 3_000;

/**
 * The providers the keeper uses on Base and X Layer (BE-96 step 4, BE-81): KyberSwap and Aero on Base; OKX and Uniswap
 * on X Layer. 1inch is left out: its one request per second is shared with the API's quotes.
 */
export function keeperProviders(chainId: 8453 | 196, client: PublicClient, keys: DepthSwapKeys): SwapProvider[] {
  if (chainId === 8453) {
    const ext = externalByChain[8453];
    return [
      createKyber({ baseUrl: KYBER_BASE_URL, clientId: keys.kyberClientId, apiKey: keys.kyberApiKey }),
      createAero({ client, factory: ext.aeroClFactory, swapRouter: ext.aeroSwapRouter, metaQuoter: ext.aeroMetaQuoter }),
    ];
  }
  const ext = externalByChain[196];
  return [
    ...(keys.okx ? [createOkx({ chainId, ...keys.okx, router: ext.okxDexRouter, approve: ext.okxDexApprove, minGapMs: KEEPER_OKX_GAP_MS })] : []),
    createUniswapV3({ client, swapRouter02: ext.uniswapSwapRouter02, quoterV2: ext.uniswapQuoterV2 }),
  ];
}

/** The swap source the depth job measures on one chain: KyberSwap on Monad, the best of `keeperProviders` elsewhere. */
export function depthSwap(chainId: ChainId, client: PublicClient, keys: DepthSwapKeys): SwapSource {
  if (chainId === 143) return createKyber({ baseUrl: keys.kyberMonadUrl ?? KYBER_MONAD_URL, clientId: keys.kyberClientId, apiKey: keys.kyberApiKey });
  const providers = keeperProviders(chainId, client, keys);
  return providers.length === 1 ? providers[0]! : bestRoute(providers);
}

/**
 * The swap the protector or the liquidator bot trades through on Base and X Layer (BE-73, BE-80): the best of the
 * providers that `contract` (the router or the `Liquidator`) accepts in `swapTargets()`, so a plan never names a target
 * the contract would refuse. Pass the same `providers` to both, so the OKX gap holds across them.
 */
export function executionSwap(client: PublicClient, contract: Address, providers: readonly SwapProvider[]): SwapSource {
  return routeForRouter(client, contract, providers)!;
}
