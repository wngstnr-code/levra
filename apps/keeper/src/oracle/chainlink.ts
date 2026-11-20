import { oracleUpdates, type Db } from "@levra/db";
import { chainlinkFeedAbi } from "@levra/shared/abis";
import type { ChainlinkStock } from "@levra/shared/markets";
import { and, eq, isNull, sql } from "drizzle-orm";
import { parseAbi, type Address, type PublicClient } from "viem";
import type { Job } from "../runner";

/**
 * Records every round of the Chainlink feeds of one chain in `oracle_updates` (BE-97), for the Base and X Layer stocks.
 * Rounds are read through the feed proxy with `getRoundData`, not from logs: round ids within a phase are consecutive,
 * so a gap shows, and it needs only `eth_call` (the public Base RPC refuses `eth_getLogs`, X Layer's allows 100 blocks).
 */

/** The proxy calls our contracts do not use, so they are not in the generated ABIs. Chainlink `AggregatorProxy`. */
const proxyHistoryAbi = parseAbi([
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

/** A proxy round id is the phase in the top bits and the aggregator's own round below (Chainlink `AggregatorProxy`). */
const PHASE_SHIFT = 64n;
const AGGREGATOR_ROUND_MASK = (1n << PHASE_SHIFT) - 1n;
export const phaseOf = (roundId: bigint) => roundId >> PHASE_SHIFT;
export const aggregatorRoundOf = (roundId: bigint) => roundId & AGGREGATOR_ROUND_MASK;

/** Every feed of our stocks has 8 decimals (05). Stored prices are E8, so another scale is refused. */
const FEED_DECIMALS = 8;

export type FeedRound = { roundId: bigint; answer: bigint; updatedAt: bigint };

/** What the recorder reads from the chain. `rounds` returns null for a round with no data (`updatedAt` 0). */
export type FeedReader = {
  decimals(feeds: Address[]): Promise<number[]>;
  latest(feeds: Address[]): Promise<FeedRound[]>;
  rounds(feed: Address, roundIds: bigint[]): Promise<(FeedRound | null)[]>;
};

export function chainFeedReader(client: PublicClient, batch = 200): FeedReader {
  return {
    async decimals(feeds) {
      const out = await client.multicall({
        allowFailure: false,
        contracts: feeds.map((address) => ({ address, abi: chainlinkFeedAbi, functionName: "decimals" }) as const),
      });
      return out.map(Number);
    },
    async latest(feeds) {
      const out = await client.multicall({
        allowFailure: false,
        contracts: feeds.map((address) => ({ address, abi: chainlinkFeedAbi, functionName: "latestRoundData" }) as const),
      });
      return out.map(([roundId, answer, , updatedAt]) => ({ roundId, answer, updatedAt }));
    },
    async rounds(feed, roundIds) {
      const result: (FeedRound | null)[] = [];
      for (let i = 0; i < roundIds.length; i += batch) {
        const out = await client.multicall({
          allowFailure: false,
          contracts: roundIds.slice(i, i + batch).map((id) => ({ address: feed, abi: proxyHistoryAbi, functionName: "getRoundData", args: [id] }) as const),
        });
        result.push(...out.map(([roundId, answer, , updatedAt]) => (updatedAt === 0n ? null : { roundId, answer, updatedAt })));
      }
      return result;
    },
  };
}

export type ChainlinkRecorderOptions = {
  reader: FeedReader;
  stocks: readonly ChainlinkStock[];
  /** On a feed's first run the recorder reads back this far. */
  backfillSeconds: number;
  /** Rounds read per feed per run, so one run stays short; the rest follows on the next run. */
  maxRoundsPerRun?: number;
  intervalMs?: number;
  now?: () => number;
};

type Stored = { roundId: bigint; updatedAt: bigint };

async function lastStored(db: Db, chainId: number, feed: string): Promise<Stored | null> {
  const [row] = await db
    .select({ roundId: oracleUpdates.roundId, publishedAt: oracleUpdates.publishedAt })
    .from(oracleUpdates)
    .where(and(eq(oracleUpdates.chainId, chainId), eq(oracleUpdates.priceId, feed), isNull(oracleUpdates.txHash)))
    .orderBy(sql`${oracleUpdates.roundId} desc`)
    .limit(1);
  return row ? { roundId: BigInt(row.roundId), updatedAt: BigInt(Math.floor(row.publishedAt.getTime() / 1000)) } : null;
}

/**
 * Rounds of the latest phase newer than `after` (unix seconds), oldest first, read backwards from `latest`. Stops at
 * round 1 of the phase: an older phase is not read, since the old aggregator can keep getting rounds after the proxy
 * moved on (Base AAPL: phase 1 wrote until 14 August 2026, nine days after phase 2 began), and those were never served.
 */
async function roundsSince(reader: FeedReader, feed: Address, latest: FeedRound, after: bigint): Promise<{ rounds: FeedRound[]; reachedPhaseStart: boolean }> {
  if (latest.updatedAt <= after) return { rounds: [], reachedPhaseStart: false };
  const phase = phaseOf(latest.roundId);
  const found: FeedRound[] = [latest];
  let next = aggregatorRoundOf(latest.roundId) - 1n;
  while (next >= 1n) {
    const count = next < 200n ? next : 200n;
    const ids = Array.from({ length: Number(count) }, (_, i) => (phase << PHASE_SHIFT) | (next - BigInt(i)));
    const page = await reader.rounds(feed, ids);
    for (const [i, round] of page.entries()) {
      if (!round) throw new Error(`Feed ${feed} has no data for round ${ids[i]}, below its latest round ${latest.roundId}`);
      if (round.updatedAt <= after) return { rounds: found.reverse(), reachedPhaseStart: false };
      found.push(round);
    }
    next -= count;
  }
  return { rounds: found.reverse(), reachedPhaseStart: true };
}

/** The rounds after `stored` up to `latest` in the same phase, oldest first, at most `limit`. */
async function roundsAfter(reader: FeedReader, feed: Address, stored: bigint, latest: bigint, limit: number): Promise<FeedRound[]> {
  const from = aggregatorRoundOf(stored) + 1n;
  const to = aggregatorRoundOf(latest);
  const count = to - from + 1n < BigInt(limit) ? to - from + 1n : BigInt(limit);
  if (count <= 0n) return [];
  const phase = phaseOf(latest);
  const ids = Array.from({ length: Number(count) }, (_, i) => (phase << PHASE_SHIFT) | (from + BigInt(i)));
  const page = await reader.rounds(feed, ids);
  return page.map((round, i) => {
    if (!round) throw new Error(`Feed ${feed} has no data for round ${ids[i]}, below its latest round ${latest}`);
    return round;
  });
}

export function createChainlinkRecorder({ reader, stocks, backfillSeconds, maxRoundsPerRun = 5_000, intervalMs = 15_000, now = Date.now }: ChainlinkRecorderOptions): Job {
  const feeds = stocks.map((s) => s.priceFeed);
  let decimalsChecked = false;
  return {
    name: "oracleMonitor",
    intervalMs,
    async run({ db, chainId, logger }) {
      if (!decimalsChecked) {
        const decimals = await reader.decimals(feeds);
        const wrong = stocks.filter((_, i) => decimals[i] !== FEED_DECIMALS);
        if (wrong.length > 0) throw new Error(`Feeds without ${FEED_DECIMALS} decimals: ${wrong.map((s) => `${s.symbol} ${s.priceFeed}`).join(", ")}`);
        decimalsChecked = true;
      }
      const latest = await reader.latest(feeds);
      let inserted = 0;
      let behindRounds = 0;
      const feedAgeSeconds: Record<string, number> = {};

      for (const [i, stock] of stocks.entries()) {
        const feed = stock.priceFeed;
        const head = latest[i]!;
        const stored = await lastStored(db, chainId, feed.toLowerCase());
        let rounds: FeedRound[];
        if (stored === null) {
          const cutoff = BigInt(Math.floor(now() / 1000 - backfillSeconds));
          const back = await roundsSince(reader, feed, head, cutoff);
          if (back.reachedPhaseStart) logger.info({ symbol: stock.symbol, feed, phase: Number(phaseOf(head.roundId)) }, "feed history starts at its phase start, after the backfill window");
          rounds = back.rounds;
        } else if (stored.roundId === head.roundId) {
          rounds = [];
        } else if (phaseOf(stored.roundId) === phaseOf(head.roundId)) {
          rounds = await roundsAfter(reader, feed, stored.roundId, head.roundId, maxRoundsPerRun);
        } else {
          logger.warn({ symbol: stock.symbol, feed, from: Number(phaseOf(stored.roundId)), to: Number(phaseOf(head.roundId)) }, "feed moved to a new phase");
          // No round limit here: a cut would skip the rounds between the last stored one and the newest.
          rounds = (await roundsSince(reader, feed, head, stored.updatedAt)).rounds;
        }
        if (stored && phaseOf(stored.roundId) === phaseOf(head.roundId)) behindRounds += Number(aggregatorRoundOf(head.roundId) - aggregatorRoundOf(stored.roundId)) - rounds.length;
        feedAgeSeconds[stock.symbol] =Math.max(0, Math.floor(now() / 1000) - Number(head.updatedAt));

        const rows = rounds.map((r) => {
          const at = new Date(Number(r.updatedAt) * 1000);
          // `updatedAt` is the block time of the round's transaction, and the age our ChainlinkSessionOracle checks.
          return { chainId, symbol: stock.symbol, priceId: feed.toLowerCase(), roundId: r.roundId.toString(), priceE8: r.answer.toString(), feedUpdatedAt: at, publishedAt: at, blockTime: at };
        });
        for (let j = 0; j < rows.length; j += 1_000) {
          const result = await db.insert(oracleUpdates).values(rows.slice(j, j + 1_000)).onConflictDoNothing().returning({ round: oracleUpdates.roundId });
          inserted += result.length;
        }
      }
      return { feeds: feeds.length, inserted, behindRounds, feedAgeSeconds };
    },
  };
}
