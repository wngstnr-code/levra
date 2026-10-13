import { createPublicClient, http, type PublicClient } from "viem";
import { monad } from "viem/chains";

export function createChainClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain: monad, transport: http(rpcUrl, { retryCount: 3, timeout: 20_000 }) });
}
