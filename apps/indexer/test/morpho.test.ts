import { createDb, morphoEvents, morphoPositions, runMigrations, syncCursors } from "@levra/db";
import { external } from "@levra/shared/addresses";
import { morphoAbi } from "@levra/shared/abis";
import type { Deployment } from "@levra/shared/deployments";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Hex } from "viem";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { morphoTopics, toMorphoRow } from "../src/morpho";
import type { LogQuery, LogSource, RawLog } from "../src/sources/types";
import { MORPHO_CURSOR, morphoStream, syncStream } from "../src/sync";
import { marketId, router, user } from "./fixtures";

const url = process.env.TEST_DATABASE_URL;
let block = 1_000n;

/** A Morpho event built with the shared ABI, as Morpho would emit it. */
function morphoLog(name: "SupplyCollateral" | "Borrow" | "Repay" | "WithdrawCollateral" | "Liquidate", args: Record<string, unknown>): RawLog {
  const event = getAbiItem({ abi: morphoAbi, name }) as { inputs: readonly { name: string; type: string; indexed?: boolean }[] };
  const topics = encodeEventTopics({ abi: morphoAbi, eventName: name, args } as Parameters<typeof encodeEventTopics>[0]);
  const nonIndexed = event.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name]));
  block += 1n;
  return { blockNumber: block, blockTime: 1_791_876_000, logIndex: 0, txHash: `0x${block.toString(16).padStart(64, "0")}`, address: external.morpho, topics: topics as RawLog["topics"], data };
}

const ids = { id: marketId };
const collateral = (assets: bigint) => morphoLog("SupplyCollateral", { ...ids, caller: user, onBehalf: user, assets });
const borrow = (assets: bigint, shares: bigint) => morphoLog("Borrow", { ...ids, caller: user, onBehalf: user, receiver: user, assets, shares });
const repay = (assets: bigint, shares: bigint) => morphoLog("Repay", { ...ids, caller: user, onBehalf: user, assets, shares });
const liquidate = (seized: bigint, repaidShares: bigint) =>
  morphoLog("Liquidate", { ...ids, caller: router, borrower: user, repaidAssets: 1n, repaidShares, seizedAssets: seized, badDebtAssets: 0n, badDebtShares: 0n });

describe("Morpho events", () => {
  it("decodes with the owner of the position as user, also for a liquidation", () => {
    expect(toMorphoRow(borrow(5n, 7n))).toMatchObject({ name: "Borrow", user, marketId, args: { assets: "5", shares: "7" } });
    expect(toMorphoRow(liquidate(3n, 2n))).toMatchObject({ name: "Liquidate", user, args: { seizedAssets: "3" } });
    expect(morphoTopics).toHaveLength(7);
  });

  it("asks only for our markets in topic 1", () => {
    const deployment = { markets: [{ marketId }], router } as unknown as Deployment;
    expect(morphoStream(deployment)).toMatchObject({ address: external.morpho, topic1: [marketId] });
  });
});

describe.skipIf(!url)("positions rebuilt from Morpho events (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const deployment = { chainId: 143, block: 1_000, router, riskManager: router, lens: router, markets: [{ marketId }] } as unknown as Deployment;

  beforeEach(async () => {
    await runMigrations(url ?? "");
    await db.delete(morphoEvents);
    await db.delete(syncCursors).where(eq(syncCursors.name, MORPHO_CURSOR));
  });
  afterAll(() => close());

  it("sums collateral and borrow shares, including a liquidation, and replays to the same result", async () => {
    const logs = [collateral(1_000n), borrow(400n, 400_000n), repay(100n, 100_000n), liquidate(250n, 50_000n)];
    const queries: LogQuery[] = [];
    const source: LogSource = {
      name: "rpc",
      head: async () => block,
      logs: async (q) => {
        queries.push(q);
        return { logs: logs.filter((l) => l.blockNumber >= q.fromBlock && l.blockNumber <= q.toBlock), nextBlock: q.toBlock + 1n };
      },
    };

    await syncStream(db, source, deployment, morphoStream(deployment));
    expect(queries[0]?.topic1).toEqual([marketId]);
    const expected = [{ user, marketId, collateral: 750n, borrowShares: 250_000n }];
    expect(await morphoPositions(db, { user })).toEqual(expected);

    await db.delete(syncCursors).where(eq(syncCursors.name, MORPHO_CURSOR));
    expect((await syncStream(db, source, deployment, morphoStream(deployment))).inserted).toBe(0);
    expect(await morphoPositions(db, { marketId: marketId as Hex })).toEqual(expected);
  });
});
