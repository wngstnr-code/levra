import { readArrivals, type Arrival } from "@levra/cctp";
import type { Address, PublicClient } from "viem";

/** Blocks read back on the first run, so a deposit that landed while the keeper restarted (a deploy) still alerts. */
const START_LOOKBACK_BLOCKS = 600n;
/** The most blocks one run reads; after a longer stop the older ones are skipped. Initial proposal. */
const MAX_BLOCKS_PER_RUN = 6_000n;
/** Arrivals are kept this long and offered again on every run, so a send that failed is retried. */
const KEEP_SECONDS = 86_400;

export type TimedArrival = Arrival & { blockTime: number };
/** USDC that arrived through CCTP to any of `recipients` lately (BE-76). */
export type ArrivalSource = (recipients: readonly Address[]) => Promise<TimedArrival[]>;

/** Follows the chain's CCTP mints of `usdc` from where the last run stopped. */
export function cctpArrivals(client: PublicClient, usdc: Address, now: () => number = () => Math.floor(Date.now() / 1000)): ArrivalSource {
  let next: bigint | null = null;
  let kept: TimedArrival[] = [];
  return async (recipients) => {
    const head = await client.getBlockNumber();
    const oldest = head > MAX_BLOCKS_PER_RUN ? head - MAX_BLOCKS_PER_RUN : 0n;
    let from = next ?? (head > START_LOOKBACK_BLOCKS ? head - START_LOOKBACK_BLOCKS : 0n);
    if (from < oldest) from = oldest;
    if (from <= head) {
      const found = await readArrivals(client, { usdc, recipients, fromBlock: from, toBlock: head });
      const times = new Map<bigint, number>();
      for (const b of new Set(found.map((a) => a.blockNumber))) times.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp));
      const known = new Set(kept.map((a) => `${a.txHash}:${a.logIndex}`));
      kept.push(...found.filter((a) => !known.has(`${a.txHash}:${a.logIndex}`)).map((a) => ({ ...a, blockTime: times.get(a.blockNumber)! })));
      next = head + 1n;
    }
    kept = kept.filter((a) => a.blockTime >= now() - KEEP_SECONDS);
    return kept;
  };
}
