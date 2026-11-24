import { externalByChain } from "@levra/shared/addresses";
import type { ChainId } from "@levra/shared/chains";
import { bestRoute, createAero, createKyber, createOkx, createUniswapV3, KYBER_BASE_URL, KYBER_MONAD_URL, type SwapSource } from "@levra/swap";
import type { PublicClient } from "viem";

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
 * The swap source the depth job measures on one chain (BE-96 step 4, BE-81): KyberSwap on Monad; the better of
 * KyberSwap and Aero on Base; the better of OKX and Uniswap on X Layer. 1inch is left out: its one request per second is
 * shared with the API's quotes.
 */
export function depthSwap(chainId: ChainId, client: PublicClient, keys: DepthSwapKeys): SwapSource {
  if (chainId === 143) return createKyber({ baseUrl: keys.kyberMonadUrl ?? KYBER_MONAD_URL, clientId: keys.kyberClientId, apiKey: keys.kyberApiKey });
  if (chainId === 8453) {
    const ext = externalByChain[8453];
    return bestRoute([
      createKyber({ baseUrl: KYBER_BASE_URL, clientId: keys.kyberClientId, apiKey: keys.kyberApiKey }),
      createAero({ client, factory: ext.aeroClFactory, swapRouter: ext.aeroSwapRouter, metaQuoter: ext.aeroMetaQuoter }),
    ]);
  }
  const ext = externalByChain[196];
  const uniswap = createUniswapV3({ client, swapRouter02: ext.uniswapSwapRouter02, quoterV2: ext.uniswapQuoterV2 });
  if (!keys.okx) return uniswap;
  const okx = createOkx({ chainId, ...keys.okx, router: ext.okxDexRouter, approve: ext.okxDexApprove, minGapMs: KEEPER_OKX_GAP_MS });
  return bestRoute([okx, uniswap]);
}
