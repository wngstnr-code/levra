import type { KeeperName, StatusResponse } from "@levra/shared/api";

/** Blocks the indexer may trail the chain before numbers count as old. Monad makes about 2 blocks a second. */
export const MAX_INDEXER_LAG_BLOCKS = 120;

/** The team monitor (BE-50) only alerts the team; when it is down, nothing users see is late. */
const TEAM_ONLY: KeeperName[] = ["monitor"];

export function serviceHealth(status: StatusResponse) {
  return {
    staleSymbols: status.oracle.filter((o) => o.stale).map((o) => o.symbol),
    degraded: status.indexer.lagBlocks > MAX_INDEXER_LAG_BLOCKS || status.keepers.some((k) => !k.healthy && !TEAM_ONLY.includes(k.name)),
  };
}
