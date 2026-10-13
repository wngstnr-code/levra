import { createPublicClient, http, type PublicClient } from "viem";
import { monad } from "viem/chains";

/** JSON-RPC batching and multicall keep the API under the endpoint's request limit. */
export function createChainClient(rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: monad,
    batch: { multicall: true },
    transport: http(rpcUrl, { batch: { wait: 10 }, retryCount: 2, timeout: 15_000 }),
  });
}
