import { createDb, dexQuotes, marketRates, runMigrations } from "@levra/db";
import { marketDetail } from "@levra/shared/api";
import { stocks } from "@levra/shared/markets";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { ChainReader, MarketState } from "../src/chain/reader";

const url = process.env.TEST_DATABASE_URL;
const WAD = 10n ** 18n;
const ids = { long: `0x${"1a".repeat(32)}`, short: `0x${"1b".repeat(32)}`, other: `0x${"1c".repeat(32)}` } as const;

function market(side: "long" | "short"): MarketState {
  return {
    info: { symbol: "HOOD", side, marketId: ids[side], stock: stocks.HOOD, collateralToken: stocks.HOOD.token, loanToken: stocks.HOOD.token, oracle: stocks.HOOD.token, lltv: "625000000000000000" },
    enabled: true,
    lltvWad: (625n * WAD) / 1000n,
    softLtvOpenWad: WAD / 2n,
    softLtvClosedWad: (4n * WAD) / 10n,
    currentSoftLtvWad: WAD / 2n,
    maxPositionUsdRaw: 500_000_000n,
    maxDeviationBps: 300,
    maxOracleAge: 3_600,
    totalSupplyRaw: 1_000_000_000n,
    totalBorrowRaw: 250_000_000n,
    borrowRatePerSecondWad: 1_000_000_000n,
    morphoFeeWad: 0n,
    oraclePriceE8: 9_000_000_000n,
    bidE8: 0n,
    askE8: 0n,
    session: "REGULAR",
    feedUpdatedAt: 1_791_880_000,
    publishedAt: 1_791_880_600,
    oracleStale: false,
    oracleHardStale: false,
  } as MarketState;
}

const reader = {
  deployment: { chainId: 143, markets: [] },
  markets: async () => [market("long"), market("short")],
  session: async () => ({ session: "REGULAR", closedRegime: false, nextCloseAt: null, preCloseWindow: 1_800, openingPaused: false, blockTime: 1_791_880_700 }),
} as unknown as ChainReader;

describe.skipIf(!url)("market detail (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const app = createApp({ logger: pino({ level: "silent" }), reader, db });
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000);
  /** The last point in each hour, as the query keeps it. */
  const lastPerHour = (points: [number, number][]) => [...new Map(points.map(([minutes, v]) => [Math.floor(ago(minutes).getTime() / 3_600_000), v])).values()];

  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(dexQuotes).where(eq(dexQuotes.symbol, "HOOD"));
    await db.delete(marketRates).where(eq(marketRates.symbol, "HOOD"));
    const quote = { symbol: "HOOD", sizeUsdRaw: "100000000", amountIn: "100000000", oraclePriceE8: "9000000000" };
    await db.insert(dexQuotes).values([
      // An old depth run that the latest one replaces, and a failed size that is left out.
      { ...quote, runId: "old", kind: "buy", priceImpactBps: 99, deviationBps: 99, measuredAt: ago(3 * 24 * 60) },
      { ...quote, runId: "new", kind: "buy", priceImpactBps: 12, deviationBps: 40, measuredAt: ago(30) },
      { ...quote, runId: "new", kind: "sell", priceImpactBps: 15, deviationBps: -35, measuredAt: ago(30) },
      { ...quote, runId: "new", kind: "sell", sizeUsdRaw: "1000000000", error: "NO_ROUTE", measuredAt: ago(30) },
      // Mid measurements: two in the same hour (the later one stays) and one far older than the window.
      { ...quote, runId: "m1", kind: "mid", midPriceE8: "9010000000", deviationBps: 11, measuredAt: ago(125) },
      { ...quote, runId: "m2", kind: "mid", midPriceE8: "9020000000", deviationBps: 22, measuredAt: ago(5) },
      { ...quote, runId: "m3", kind: "mid", midPriceE8: "9030000000", deviationBps: 33, measuredAt: ago(1) },
      { ...quote, runId: "m0", kind: "mid", midPriceE8: "9040000000", deviationBps: 44, measuredAt: ago(40 * 24 * 60) },
    ]);
    const rate = { symbol: "HOOD", borrowApyWad: "50000000000000000", supplyApyWad: "12500000000000000", utilizationWad: "250000000000000000", totalSupplyRaw: "1000000000", totalBorrowRaw: "250000000" };
    await db.insert(marketRates).values([
      { ...rate, marketId: ids.long, side: "long", measuredAt: ago(125) },
      { ...rate, marketId: ids.long, side: "long", borrowApyWad: "60000000000000000", measuredAt: ago(1) },
      { ...rate, marketId: ids.short, side: "short", measuredAt: ago(1) },
      { ...rate, marketId: ids.other, side: "long", measuredAt: ago(1) },
    ]);
  });
  afterAll(() => close());

  it("gives both sides, the latest depth run and hourly rate and deviation history", async () => {
    const res = await app.request("/v1/markets/hood");
    expect(res.status).toBe(200);
    const d = marketDetail.parse(await res.json());
    expect(d).toMatchObject({ symbol: "HOOD", name: stocks.HOOD.name, stockToken: stocks.HOOD.token });
    expect(d.markets.map((m) => m.side)).toEqual(["long", "short"]);
    expect(d.markets[0]!.dexMidPriceE8).toBe("9030000000");
    expect(d.depth.map((p) => [p.direction, p.priceImpactBps, p.deviationBps])).toEqual([
      ["buy", 12, 40],
      ["sell", 15, -35],
    ]);
    expect(d.deviationHistory.map((p) => p.deviationBps)).toEqual(lastPerHour([[125, 11], [5, 22], [1, 33]]));
    expect(d.rateHistory.every((r) => r.marketId === ids.long || r.marketId === ids.short)).toBe(true);
    expect(d.rateHistory.filter((r) => r.marketId === ids.long).map((r) => r.borrowApyWad)).toEqual(["50000000000000000", "60000000000000000"]);
    expect(d.rateHistory.filter((r) => r.marketId === ids.short)).toHaveLength(1);
  });

  it("answers 404 for a stock we do not list", async () => {
    expect((await app.request("/v1/markets/TSLA")).status).toBe(404);
  });
});
