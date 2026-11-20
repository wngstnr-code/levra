import { createDb, oracleUpdates, runMigrations } from "@levra/db";
import { baseStocks } from "@levra/shared/markets";
import { and, asc, eq } from "drizzle-orm";
import pino from "pino";
import type { Address } from "viem";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createChainlinkRecorder, type FeedReader, type FeedRound } from "../src/oracle/chainlink";

const url = process.env.TEST_DATABASE_URL;
const logger = pino({ level: "silent" });
const NVDA = baseStocks.NVDA;
const feed = NVDA.priceFeed;
const id = (phase: bigint, round: bigint) => (phase << 64n) | round;
const NOW = 1_795_000_000;

/** A feed whose rounds can grow between runs. Round `r` of a phase is written at `start + r * 60` seconds. */
function fakeFeed(decimals = 8) {
  const rounds = new Map<bigint, FeedRound>();
  let head: bigint | null = null;
  const reads: bigint[] = [];
  const add = (phase: bigint, from: bigint, to: bigint, start: number) => {
    for (let r = from; r <= to; r++) {
      const roundId = id(phase, r);
      rounds.set(roundId, { roundId, answer: 14_000_000_000n + r, updatedAt: BigInt(start + Number(r) * 60) });
      head = roundId;
    }
  };
  const reader: FeedReader = {
    decimals: async (feeds) => feeds.map(() => decimals),
    latest: async (feeds) => feeds.map(() => rounds.get(head!)!),
    rounds: async (_feed: Address, ids) => {
      reads.push(...ids);
      return ids.map((i) => rounds.get(i) ?? null);
    },
  };
  return { reader, add, rounds, reads, drop: (roundId: bigint) => rounds.delete(roundId) };
}

describe.skipIf(!url)("Chainlink price recorder (BE-97, needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const ctx = (chainId: 8453 | 196 = 8453) => ({ db, chainId, logger, signal: new AbortController().signal });
  const stored = async (chainId = 8453) =>
    db.select().from(oracleUpdates).where(and(eq(oracleUpdates.chainId, chainId), eq(oracleUpdates.priceId, feed.toLowerCase()))).orderBy(asc(oracleUpdates.roundId));
  const recorder = (reader: FeedReader, backfillSeconds: number, maxRoundsPerRun?: number) =>
    createChainlinkRecorder({ reader, stocks: [NVDA], backfillSeconds, maxRoundsPerRun, now: () => NOW * 1000 });

  beforeEach(async () => {
    await runMigrations(url ?? "");
    await db.delete(oracleUpdates);
  });
  afterAll(() => close());

  it("backfills the window on the first run, oldest first, with the proxy round id and no bid, ask, session or log", async () => {
    const f = fakeFeed();
    // 600 rounds, round r at NOW - (601 - r) minutes. A window of 300.5 minutes keeps rounds 301 to 600.
    f.add(2n, 1n, 600n, NOW - 601 * 60);
    expect(await recorder(f.reader, 300 * 60 + 30).run(ctx())).toMatchObject({ inserted: 300 });

    const rows = await stored();
    expect(rows.map((r) => BigInt(r.roundId))).toEqual(Array.from({ length: 300 }, (_, i) => id(2n, 301n + BigInt(i))));
    expect(rows[0]).toMatchObject({ symbol: "NVDA", priceE8: "14000000301", bestBidE8: null, bestAskE8: null, session: null, txHash: null, logIndex: null, blockNumber: null });
    expect(rows[0]!.blockTime).toEqual(rows[0]!.publishedAt);
    expect(rows[0]!.feedUpdatedAt).toEqual(rows[0]!.publishedAt);
  });

  it("then follows each new round once, in pages, without a gap", async () => {
    const f = fakeFeed();
    f.add(2n, 1n, 10n, NOW - 11 * 60);
    const job = recorder(f.reader, 86_400, 5);
    await job.run(ctx());
    expect(await job.run(ctx())).toMatchObject({ inserted: 0 });

    f.add(2n, 11n, 22n, NOW - 11 * 60);
    expect(await job.run(ctx())).toMatchObject({ inserted: 5, behindRounds: 7 });
    expect(await job.run(ctx())).toMatchObject({ inserted: 5, behindRounds: 2 });
    expect(await job.run(ctx())).toMatchObject({ inserted: 2, behindRounds: 0 });
    expect((await stored()).map((r) => BigInt(r.roundId))).toEqual(Array.from({ length: 22 }, (_, i) => id(2n, BigInt(i + 1))));
  });

  it("stops at the start of the current phase and never reads an older phase", async () => {
    const f = fakeFeed();
    f.add(1n, 1n, 50n, NOW - 200 * 60);
    f.add(2n, 1n, 40n, NOW - 41 * 60);
    expect(await recorder(f.reader, 365 * 86_400).run(ctx())).toMatchObject({ inserted: 40 });
    expect(f.reads.every((r) => r >> 64n === 2n)).toBe(true);
  });

  it("after a phase change keeps only the new rounds newer than the last stored one", async () => {
    const f = fakeFeed();
    f.add(2n, 1n, 10n, NOW - 100 * 60);
    const job = recorder(f.reader, 86_400);
    await job.run(ctx());
    const lastStoredAt = Number((await stored()).at(-1)!.publishedAt.getTime() / 1000);

    // Phase 3 began before the switch: its rounds 1 to 6 overlap what phase 2 served, rounds 7 to 9 are new.
    f.add(3n, 1n, 9n, lastStoredAt - 6 * 60);
    expect(await job.run(ctx())).toMatchObject({ inserted: 3 });
    expect((await stored()).slice(-4).map((r) => BigInt(r.roundId))).toEqual([id(2n, 10n), id(3n, 7n), id(3n, 8n), id(3n, 9n)]);
  });

  it("fails rather than skip a round the feed has no data for", async () => {
    const f = fakeFeed();
    f.add(2n, 1n, 5n, NOW - 6 * 60);
    const job = recorder(f.reader, 86_400);
    await job.run(ctx());
    f.add(2n, 6n, 9n, NOW - 6 * 60);
    f.drop(id(2n, 7n));
    await expect(job.run(ctx())).rejects.toThrow(/no data for round/);
    expect((await stored()).length).toBe(5);
  });

  it("refuses a feed whose decimals are not 8", async () => {
    const f = fakeFeed(18);
    f.add(2n, 1n, 2n, NOW - 3 * 60);
    await expect(recorder(f.reader, 86_400).run(ctx())).rejects.toThrow(/without 8 decimals: NVDA/);
  });

  it("keeps each chain's rounds apart", async () => {
    const f = fakeFeed();
    f.add(2n, 1n, 3n, NOW - 4 * 60);
    await recorder(f.reader, 86_400).run(ctx(8453));
    expect(await recorder(f.reader, 86_400).run(ctx(196))).toMatchObject({ inserted: 3 });
    expect((await stored(8453)).length).toBe(3);
    expect((await stored(196)).length).toBe(3);
  });
});
