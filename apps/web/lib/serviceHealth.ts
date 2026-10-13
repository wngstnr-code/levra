import type { StatusResponse } from "@levra/shared/api";

/** Blocks the indexer may trail the chain before numbers count as old. Monad makes about 2 blocks a second. */
export const MAX_INDEXER_LAG_BLOCKS = 120;

export function serviceHealth(status: StatusResponse) {
  return {
    staleSymbols: status.oracle.filter((o) => o.stale).map((o) => o.symbol),
    degraded: status.indexer.lagBlocks > MAX_INDEXER_LAG_BLOCKS || status.keepers.some((k) => !k.healthy),
  };
}
