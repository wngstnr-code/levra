import { externalByChain } from "@levra/shared/addresses";
import type { ChainId } from "@levra/shared/chains";
import { bestRoute, createAero, createKyber, KYBER_BASE_URL, KYBER_MONAD_URL, type SwapSource } from "@levra/swap";
import type { PublicClient } from "viem";

export type DepthSwapKeys = { kyberMonadUrl?: string; kyberClientId: string; kyberApiKey?: string };

/**
 * The swap source the depth job measures on one chain (BE-96 step 4): KyberSwap on Monad; the better of KyberSwap and
 * Aero on Base. 1inch is left out: its one request per second is shared with the API's quotes. X Layer waits for the
 * OKX provider (BE-81), so null.
 */
export function depthSwap(chainId: ChainId, client: PublicClient, keys: DepthSwapKeys): SwapSource | null {
  if (chainId === 143) return createKyber({ baseUrl: keys.kyberMonadUrl ?? KYBER_MONAD_URL, clientId: keys.kyberClientId, apiKey: keys.kyberApiKey });
  if (chainId === 8453) {
    const ext = externalByChain[8453];
    return bestRoute([
      createKyber({ baseUrl: KYBER_BASE_URL, clientId: keys.kyberClientId, apiKey: keys.kyberApiKey }),
      createAero({ client, factory: ext.aeroClFactory, swapRouter: ext.aeroSwapRouter, metaQuoter: ext.aeroMetaQuoter }),
    ]);
  }
  return null;
}
