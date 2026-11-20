import { externalByChain } from "@levra/shared/addresses";
import { isChainId, type ChainId } from "@levra/shared/chains";
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { base, monad, xLayer } from "viem/chains";

export const viemChains = { 143: monad, 8453: base, 196: xLayer } as const;

export function createChainClient(chainId: ChainId, rpcUrl: string): PublicClient {
  // Base's OP stack formatters widen the block and transaction types; the keepers do not read those fields.
  return createPublicClient({ chain: viemChains[chainId], transport: http(rpcUrl, { retryCount: 3, timeout: 20_000 }) }) as PublicClient;
}

/** Morpho on the chain of a deployment. */
export function morphoOn(chainId: number): Address {
  if (!isChainId(chainId)) throw new Error(`Chain ${chainId} has no Morpho address in packages/shared`);
  return externalByChain[chainId].morpho;
}
