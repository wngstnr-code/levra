import { alertDeliveries, alertSettings, createDb, morphoEvents, routerEvents, runMigrations } from "@levra/db";
import { lensAbi } from "@levra/shared/abis";
import { WAD, mulDiv } from "@levra/shared/math";
import { eq } from "drizzle-orm";
import pino from "pino";
import { createPublicClient, http, parseUnits, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createForkClient, forkDeployment, forkRpcUrl, onFork, openOnMorpho, randomAddress } from "../../api/test/fork-helpers";
import { createAlerts } from "../src/alerts/job";

const dbUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!onFork || !dbUrl)("user alerts on the fork (BE-33)", () => {
  const deployment = forkDeployment();
  const { db, close } = createDb(dbUrl ?? "postgres://unused", { max: 2 });
  const client = createPublicClient({ transport: http(forkRpcUrl) });
  const chain = createForkClient(forkRpcUrl);
  const ctx = { db, logger: pino({ level: "silent" }), signal: new AbortController().signal };
  const long = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "long")!;
  const risky = randomAddress();
  const calm = randomAddress();
  const inbox: { to: string; subject: string; text: string }[] = [];
  const channels = { email: async (to: string, subject: string, text: string) => void inbox.push({ to, subject, text }) };

  /** One fixed close; the job's clock is moved towards it instead of the chain's, which would age the oracle. */
  const CLOSE_AT = 1_900_000_000;
  let now = 0;
  const job = createAlerts({ client, deployment, channels, nextClose: async () => CLOSE_AT, clock: async () => now });
  const runAt = async (secondsBeforeClose: number) => {
    now = CLOSE_AT - secondsBeforeClose;
    inbox.length = 0;
    await job.run(ctx);
    return inbox.map((m) => [m.to, m.subject]);
  };
  /** The real time, far from the close: events are only alerted while less than a day old. */
  const runNow = async () => {
    now = Math.floor(Date.now() / 1000);
    inbox.length = 0;
    await job.run(ctx);
    return inbox.map((m) => [m.to, m.subject]);
  };

  let snapshot: Hex;
  beforeAll(async () => {
    snapshot = await chain.snapshot();
    await runMigrations(dbUrl ?? "");
    const lm = (await client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getMarkets" })).find((m) => m.marketId === long.marketId)!;
    const stockValue = mulDiv(lm.priceE8, 10n ** 6n, 10n ** 8n);
    // Above the closed-market limit, below the hard limit; and one far below both.
    await openOnMorpho(chain, long.marketId, risky, parseUnits("1", 18), mulDiv(stockValue, (lm.softLtvClosed + lm.lltv) / 2n, WAD));
    await openOnMorpho(chain, long.marketId, calm, parseUnits("1", 18), mulDiv(stockValue, lm.softLtvClosed / 3n, WAD));

    const now = new Date();
    for (const [address, email] of [
      [risky, "risky@example.com"],
      [calm, "calm@example.com"],
    ] as const) {
      const a = address.toLowerCase();
      await db.delete(alertDeliveries).where(eq(alertDeliveries.address, a));
      await db.delete(alertSettings).where(eq(alertSettings.address, a));
      await db.insert(alertSettings).values({ address: a, email, telegramChatId: null, preClose: true, ltvThresholdWad: null, autoDeleverage: true, liquidation: true, depositArrived: true, createdAt: new Date(now.getTime() - 60_000), updatedAt: now });
    }
  }, 300_000);
  afterAll(async () => {
    for (const a of [risky, calm].map((x) => x.toLowerCase())) {
      await db.delete(alertDeliveries).where(eq(alertDeliveries.address, a));
      await db.delete(alertSettings).where(eq(alertSettings.address, a));
      await db.delete(routerEvents).where(eq(routerEvents.user, a));
      await db.delete(morphoEvents).where(eq(morphoEvents.user, a));
    }
    await chain.revert({ id: snapshot });
    await close();
  });

  it("sends the 24-hour, 4-hour and 1-hour before-close alerts once each, only to the position above the closed limit", { timeout: 120_000 }, async () => {
    expect(await runAt(25 * 3_600)).toEqual([]);
    expect(await runAt(24 * 3_600 - 60)).toEqual([["risky@example.com", "The market closes in 24 hours"]]);
    expect(await runAt(20 * 3_600)).toEqual([]);
    expect(await runAt(4 * 3_600 - 60)).toEqual([["risky@example.com", "The market closes in 4 hours"]]);
    expect(await runAt(3_600 - 60)).toEqual([["risky@example.com", "The market closes in 1 hour"]]);
    expect(await runAt(600)).toEqual([]);
  });

  it("alerts an LTV over the user's level once, and again after it went back under", { timeout: 60_000 }, async () => {
    const level = async (wad: bigint) => db.update(alertSettings).set({ ltvThresholdWad: wad.toString() }).where(eq(alertSettings.address, calm.toLowerCase()));
    await level(WAD / 100n);
    expect(await runAt(5 * 86_400)).toEqual([["calm@example.com", "LTV above 1.00%"]]);
    expect(await runAt(5 * 86_400)).toEqual([]);
    await level((99n * WAD) / 100n);
    expect(await runAt(5 * 86_400)).toEqual([]);
    await level(WAD / 100n);
    expect(await runAt(5 * 86_400)).toEqual([["calm@example.com", "LTV above 1.00%"]]);
  });

  it("alerts an auto-deleverage and a liquidation from the indexed events once", { timeout: 60_000 }, async () => {
    const a = risky.toLowerCase();
    const at = new Date();
    await db.insert(routerEvents).values({ name: "PositionReduced", user: a, marketId: long.marketId.toLowerCase(), args: { reason: 1 }, blockNumber: 1n, blockTime: at, txHash: `0xa1e${"1".repeat(61)}`, logIndex: 0 });
    await db.insert(routerEvents).values({ name: "PositionReduced", user: a, marketId: long.marketId.toLowerCase(), args: { reason: 0 }, blockNumber: 2n, blockTime: at, txHash: `0xa1e${"2".repeat(61)}`, logIndex: 0 });
    await db.insert(morphoEvents).values({ name: "Liquidate", user: a, marketId: long.marketId.toLowerCase(), args: {}, blockNumber: 3n, blockTime: at, txHash: `0xa1e${"3".repeat(61)}`, logIndex: 0 });
    expect((await runNow()).sort()).toEqual([
      ["risky@example.com", "Position liquidated"],
      ["risky@example.com", "Position reduced by protection"],
    ]);
    expect(await runNow()).toEqual([]);
  });
});
