import { createDb, dexQuotes, latestDexMids, runMigrations } from "@levra/db";
import { SwapError, type SwapSource } from "@levra/swap";
import { baseTokens, tokens } from "@levra/shared/addresses";
import { baseStocks, stocks } from "@levra/shared/markets";
import pino from "pino";
import type { PublicClient } from "viem";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEPTH_SIZES_USD, chainlinkPrices, createMarketDepth, measureStock } from "../src/dex/depth";
import { depthSwap } from "../src/dex/swap";
import type { FeedReader } from "../src/oracle/chainlink";

const ORACLE = 100_000_000_000n; // $1,000

/** A pool at $1,000 with a 1% cost each way, and nothing for sales above $3,000 when `thin`. */
function fakeSwap(thin = false): SwapSource {
  return {
    quote: async () => {
      throw new Error("not used");
    },
    async price({ tokenIn, amountIn }) {
      if (tokenIn === tokens.USDC.address) return (amountIn * 10n ** 12n * 99n) / 100n / 1_000n;
      const usd = (amountIn * 1_000n) / 10n ** 12n;
      if (thin && usd > 3_000_000_000n) throw new SwapError("NO_ROUTE", "no route");
      return (usd * 99n) / 100n;
    },
  };
}

const ctx = (swap: SwapSource) => ({ swap, usdc: tokens.USDC, pauseMs: 0, runId: "r1", at: new Date(), calls: { n: 0, limited: 0 } });

describe("market depth", () => {
  it("measures the mid and both sides at every size, with impact against the mid", async () => {
    const rows = await measureStock(ctx(fakeSwap()), stocks.QQQ, ORACLE, true);
    expect(rows).toHaveLength(1 + 2 * DEPTH_SIZES_USD.length);
    const mid = rows[0]!;
    expect(mid).toMatchObject({ kind: "mid", deviationBps: 0, midPriceE8: "100005050505" });
    const buy = rows.find((r) => r.kind === "buy")!;
    const sell = rows.find((r) => r.kind === "sell")!;
    expect(buy.priceImpactBps).toBe(sell.priceImpactBps);
    expect(buy.priceImpactBps! > 0).toBe(true);
    // A $100 sale sells the stock worth $100 at the oracle price: 0.1 share.
    expect(sell.amountIn).toBe((10n ** 17n).toString());
  });

  it("records a missing route instead of failing the run", async () => {
    const rows = await measureStock(ctx(fakeSwap(true)), stocks.QQQ, ORACLE, true);
    expect(rows.filter((r) => r.error === "NO_ROUTE").map((r) => r.sizeUsdRaw)).toEqual(["10000000000"]);
  });

  it("measures only the mid when a full table is not due", async () => {
    expect(await measureStock(ctx(fakeSwap()), stocks.QQQ, ORACLE, false)).toHaveLength(1);
  });
});

describe("market depth on Base and X Layer (BE-96 step 4)", () => {
  const feeds = (decimals: number[], answers: bigint[]): FeedReader => ({
    decimals: async () => decimals,
    latest: async () => answers.map((answer, i) => ({ roundId: BigInt(i + 1), answer, updatedAt: 1n })),
    rounds: async () => [],
  });

  it("prices each stock from its Chainlink feed in 8 decimals and leaves out a feed with no positive answer", async () => {
    const list = [baseStocks.AAPL, baseStocks.NVDA, baseStocks.TSLA];
    const priced = await chainlinkPrices(feeds([8, 18, 8], [27_000_000_000n, 180n * 10n ** 18n, 0n]), list)();
    expect(priced.map((p) => [p.stock.symbol, p.oraclePriceE8])).toEqual([
      ["AAPL", 27_000_000_000n],
      ["NVDA", 18_000_000_000n],
    ]);
  });

  it("measures a Base stock against Base USDC with its own decimals", async () => {
    // Base USDC has 6 decimals and the stock 8: a pool at $1,000 with a 1% cost each way.
    const swap: SwapSource = {
      quote: async () => {
        throw new Error("not used");
      },
      async price({ tokenIn, amountIn }) {
        if (tokenIn === baseTokens.USDC.address) return (amountIn * 10n ** 2n * 99n) / 100n / 1_000n;
        return (((amountIn * 1_000n) / 10n ** 2n) * 99n) / 100n;
      },
    };
    const rows = await measureStock({ ...ctx(swap), usdc: baseTokens.USDC }, baseStocks.NVDA, ORACLE, false);
    expect(rows).toEqual([expect.objectContaining({ symbol: "NVDA", kind: "mid", deviationBps: 0, midPriceE8: "100005050505" })]);
  });

  it("measures KyberSwap and Aero on Base and KyberSwap on Monad (X Layer in depth-swap.test.ts)", () => {
    const keys = { kyberClientId: "levra" };
    expect(depthSwap(143, {} as PublicClient, keys)).not.toBeNull();
    expect(depthSwap(8453, {} as PublicClient, keys)).not.toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("market depth job (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const client = { readContract: async () => ({ price: ORACLE }) } as unknown as PublicClient;
  const run = (depthEveryMs: number) =>
    createMarketDepth({ client, swap: fakeSwap(), pauseMs: 0, depthEveryMs }).run({ db, chainId: 143 as const, logger: pino({ level: "silent" }), signal: new AbortController().signal });

  beforeEach(async () => {
    await runMigrations(url ?? "");
    await db.delete(dexQuotes);
  });
  afterAll(() => close());

  it("runs the full table first, then only mids until a day has passed, and serves the latest mid", async () => {
    expect(await run(86_400_000)).toMatchObject({ full: true, rows: 33, failed: 0 });
    expect(await run(86_400_000)).toMatchObject({ full: false, rows: 3 });
    const mids = await latestDexMids(db, 143, 600);
    expect([...mids.keys()].sort()).toEqual(["BIL", "HOOD", "QQQ"]);
    // 1% cost each way: the average of buy and sell sits 0.005% above $1,000.
    expect(mids.get("QQQ")).toBe(100_005_050_505n);
  });
});
