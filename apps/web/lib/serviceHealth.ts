import type { KeeperName, StatusResponse } from "@levra/shared/api";

/** Blocks the indexer may trail the chain before numbers count as old. Monad makes about 2 blocks a second. */
export const MAX_INDEXER_LAG_BLOCKS = 120;

/** The team monitor (BE-50) only alerts the team; when it is down, nothing users see is late. */
const TEAM_ONLY: KeeperName[] = ["monitor"];

/** The chain whose numbers the top-level `oracle`, `keepers` and `indexer` of /v1/status describe (BE-95). */
const TOP_LEVEL_CHAIN_ID = 143;

/**
 * Health of one chain. The top-level fields are Monad's; another chain reads its own `chains` entry, and its stale
 * prices come from that chain's markets (`staleOnChain`), since /v1/status lists only Monad's oracles.
 */
export function serviceHealth(status: StatusResponse, chainId: number = TOP_LEVEL_CHAIN_ID, staleOnChain: string[] = []) {
  const unhealthy = (keepers: StatusResponse["keepers"]) => keepers.some((k) => !k.healthy && !TEAM_ONLY.includes(k.name));
  if (chainId === TOP_LEVEL_CHAIN_ID) {
    return {
      staleSymbols: status.oracle.filter((o) => o.stale).map((o) => o.symbol),
      degraded: status.indexer.lagBlocks > MAX_INDEXER_LAG_BLOCKS || unhealthy(status.keepers),
    };
  }
  const own = status.chains?.find((c) => c.chainId === chainId);
  return {
    staleSymbols: [...new Set(staleOnChain)],
    degraded: !!own && (own.indexer.lagBlocks > MAX_INDEXER_LAG_BLOCKS || unhealthy(own.keepers)),
  };
}
