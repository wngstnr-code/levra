import { createDb, latestOraclePrice, oraclePriceSeries, oracleUpdates, runMigrations } from "@levra/db";
import { apiError, priceHistoryResponse } from "@levra/shared/api";
import { like } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { ChainReader } from "../src/chain/reader";
import { dbMarketHistory, marketRoutes, priceBuckets, withLatestPrice } from "../src/routes/markets";

const reader = { deployment: { chainId: 143, markets: [{ symbol: "QQQ" }] } } as unknown as ChainReader;

describe("price history without a database", () => {
  const app = createApp({ logger: pino({ level: "silent" }), reader });

  it("spaces points by range and ends the window at the last whole bucket", () => {
    const now = 1_791_900_123;
    for (const [range, count] of [["1D", 288], ["1W", 168], ["1M", 180]] as const) {
      const { from, to, bucketSeconds } = priceBuckets(range, now);
      expect(from % bucketSeconds).toBe(0);
      expect(to % bucketSeconds).toBe(0);
      expect(to).toBeLessThanOrEqual(now);
      expect((to - from) / bucketSeconds + 1).toBe(count);
    }
  });

  it("appends the latest price at the request time", () => {
    const series = [{ timestamp: 600, oraclePriceE8: "1" }];
    expect(withLatestPrice(series, { timestamp: 650, oraclePriceE8: "2" }, 700)).toEqual([...series, { timestamp: 700, oraclePriceE8: "2" }]);
    expect(withLatestPrice(series, null, 700)).toEqual(series);
    expect(withLatestPrice([{ timestamp: 700, oraclePriceE8: "1" }], { timestamp: 650, oraclePriceE8: "1" }, 700)).toHaveLength(1);
    expect(withLatestPrice([], { timestamp: 650, oraclePriceE8: "3" }, 700)).toEqual([{ timestamp: 700, oraclePriceE8: "3" }]);
  });

  it("answers an empty chart without a database", async () => {
    const res = await app.request("/v1/markets/qqq/prices?range=1D");
    expect(res.status).toBe(200);
    expect(priceHistoryResponse.parse(await res.json())).toEqual({ symbol: "QQQ", range: "1D", points: [] });
  });

  it("refuses a missing or unknown range and an unlisted stock", async () => {
    for (const path of ["/v1/markets/QQQ/prices", "/v1/markets/QQQ/prices?range=1Y"]) {
      const res = await app.request(path);
      expect(res.status).toBe(400);
      expect(apiError.parse(await res.json()).error.code).toBe("BAD_REQUEST");
    }
    expect((await app.request("/v1/markets/HOOD/prices?range=1D")).status).toBe(404);
    expect((await app.request("/v1/markets/TSLA/prices?range=1D")).status).toBe(404);
  });
});

const url = process.env.TEST_DATABASE_URL;
const TX_PREFIX = "0xbe24";
/** Far in the future, so rows written by other test files never fall after ours. Aligned to 4 hours. */
const T0 = 4_102_444_800;
const E8 = 100_000_000n;

describe.skipIf(!url)("price history (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  let block = 1n;

  function write(symbol: string, at: number, priceUsd: bigint, logIndex = 0) {
    block++;
    return {
      symbol,
      priceId: "0x00",
      roundId: String(block),
      priceE8: String(priceUsd * E8),
      bestBidE8: "0",
      bestAskE8: "0",
      session: "REGULAR",
      feedUpdatedAt: new Date(at * 1000),
      publishedAt: new Date(at * 1000),
      blockNumber: 9_000_000_000n + block,
      blockTime: new Date(at * 1000),
      txHash: `${TX_PREFIX}${symbol.toLowerCase()}${block.toString(16).padStart(8, "0")}`,
      logIndex,
    };
  }

  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(oracleUpdates).where(like(oracleUpdates.txHash, `${TX_PREFIX}%`));
  });
  afterAll(async () => {
    await db.delete(oracleUpdates).where(like(oracleUpdates.txHash, `${TX_PREFIX}%`));
    await close();
  });

  it("carries the last write forward into every bucket and leaves out times before the first write", async () => {
    const symbol = "BE24TEST";
    await db.insert(oracleUpdates).values([write(symbol, T0 + 100, 10n), write(symbol, T0 + 700, 11n), write(symbol, T0 + 700, 12n, 1)]);

    const series = await oraclePriceSeries(db, symbol, T0, T0 + 1_500, 300);
    expect(series).toEqual([
      { timestamp: T0 + 300, oraclePriceE8: String(10n * E8) },
      { timestamp: T0 + 600, oraclePriceE8: String(10n * E8) },
      { timestamp: T0 + 900, oraclePriceE8: String(12n * E8) },
      { timestamp: T0 + 1_200, oraclePriceE8: String(12n * E8) },
      { timestamp: T0 + 1_500, oraclePriceE8: String(12n * E8) },
    ]);
    expect(await latestOraclePrice(db, symbol)).toEqual({ timestamp: T0 + 700, oraclePriceE8: String(12n * E8) });
    expect(await latestOraclePrice(db, "BE24NONE")).toBeNull();
  });

  it("serves 1D, 1W and 1M charts that end with the latest price", async () => {
    const now = T0 + 1_234;
    await db.insert(oracleUpdates).values([
      write("QQQ", now - 40 * 86_400, 90n),
      write("QQQ", now - 2 * 86_400, 100n),
      write("QQQ", now - 3 * 3_600, 110n),
      write("QQQ", now - 600, 120n),
      write("QQQ", now - 20, 125n),
    ]);
    const app = marketRoutes(reader, undefined, dbMarketHistory(db), () => now * 1000);

    const lengths: Record<string, number> = {};
    for (const range of ["1D", "1W", "1M"] as const) {
      const res = await app.request(`/v1/markets/QQQ/prices?range=${range}`);
      expect(res.status).toBe(200);
      const body = priceHistoryResponse.parse(await res.json());
      expect(body).toMatchObject({ symbol: "QQQ", range });
      const times = body.points.map((p) => p.timestamp);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(body.points.at(-1)).toEqual({ timestamp: now, oraclePriceE8: String(125n * E8) });
      lengths[range] = body.points.length;
      if (range === "1D") {
        expect(body.points[0]!.oraclePriceE8).toBe(String(100n * E8));
        expect(body.points.at(-2)!.oraclePriceE8).toBe(String(120n * E8));
      }
    }
    expect(lengths).toEqual({ "1D": 289, "1W": 169, "1M": 181 });
  });
});
