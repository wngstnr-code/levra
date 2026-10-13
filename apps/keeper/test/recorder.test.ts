import { createDb, oracleUpdates, runMigrations, syncCursors } from "@levra/db";
import pino from "pino";
import type { PublicClient } from "viem";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ORACLE_CURSOR, createOracleRecorder } from "../src/oracle/recorder";
import { sampleLog } from "./fixtures";

const url = process.env.TEST_DATABASE_URL;
const logger = pino({ level: "silent" });

type Range = { fromBlock: bigint; toBlock: bigint };

function fakeClient(head: bigint, logsAt: bigint[]) {
  const ranges: Range[] = [];
  const client = {
    getBlockNumber: async () => head,
    getLogs: async ({ fromBlock, toBlock }: Range) => {
      ranges.push({ fromBlock, toBlock });
      return logsAt.filter((b) => b >= fromBlock && b <= toBlock).map((b) => sampleLog({ roundId: b }, b));
    },
  } as unknown as PublicClient;
  return { client, ranges };
}

describe.skipIf(!url)("oracle recorder (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const ctx = () => ({ db, logger, signal: new AbortController().signal });

  beforeEach(async () => {
    await runMigrations(url ?? "");
    await db.delete(oracleUpdates);
    await db.delete(syncCursors);
  });
  afterAll(() => close());

  it("backfills from head minus the backfill window in 10,000 block ranges and stores each log once", async () => {
    const { client, ranges } = fakeClient(125_000n, [100_500n, 115_000n, 124_999n]);
    const job = createOracleRecorder({ client, backfillBlocks: 25_000n });

    const first = await job.run(ctx());
    expect(ranges.map((r) => [r.fromBlock, r.toBlock])).toEqual([
      [100_000n, 109_999n],
      [110_000n, 119_999n],
      [120_000n, 125_000n],
    ]);
    expect(first).toMatchObject({ lastBlock: 125_000, behindBlocks: 0, inserted: 3 });

    const [cursor] = await db.select().from(syncCursors);
    expect(cursor).toMatchObject({ name: ORACLE_CURSOR, lastBlock: 125_000n });
  });

  it("continues from the cursor and stops after the range limit, without duplicates", async () => {
    const { client } = fakeClient(130_000n, [100_500n, 128_000n]);
    const job = createOracleRecorder({ client, backfillBlocks: 30_000n, maxRangesPerRun: 1 });

    expect(await job.run(ctx())).toMatchObject({ lastBlock: 109_999, inserted: 1 });
    await job.run(ctx());
    await job.run(ctx());
    expect(await job.run(ctx())).toMatchObject({ lastBlock: 130_000, behindBlocks: 0, inserted: 0 });

    await db.update(syncCursors).set({ lastBlock: 99_999n });
    expect(await job.run(ctx())).toMatchObject({ inserted: 0 });
    expect(await db.$count(oracleUpdates)).toBe(2);
  });
});
