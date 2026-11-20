import type { ChainId } from "@levra/shared/chains";
import { createPublicClient, http, type PublicClient } from "viem";
import { base, monad, xLayer } from "viem/chains";

const viemChains = { 143: monad, 8453: base, 196: xLayer } as const;

/** JSON-RPC batching and multicall keep the API under the endpoint's request limit. */
export function createChainClient(chainId: ChainId, rpcUrl: string): PublicClient {
  // Base's OP stack formatters widen the block and transaction types; the API does not read those fields.
  return createPublicClient({
    chain: viemChains[chainId] as typeof monad,
    batch: { multicall: true },
    transport: http(rpcUrl, { batch: { wait: 10 }, retryCount: 2, timeout: 15_000 }),
  });
}
