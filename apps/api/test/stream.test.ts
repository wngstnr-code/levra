import { stocks } from "@levra/shared/markets";
import { describe, expect, it } from "vitest";
import { createCache } from "../src/chain/cache";
import type { ChainReader, ChainSession, MarketState } from "../src/chain/reader";
import { readEvents } from "../src/routes/stream";

const WAD = 10n ** 18n;

function market(overrides: Partial<MarketState> = {}): MarketState {
  return {
    info: {
      symbol: "QQQ",
      side: "long",
      marketId: `0x${"11".repeat(32)}`,
      oracle: `0x${"22".repeat(20)}`,
      collateralToken: stocks.QQQ.token,
      loanToken: `0x${"33".repeat(20)}`,
      lltv: "770000000000000000",
      stock: stocks.QQQ,
    },
    enabled: true,
    lltvWad: (77n * WAD) / 100n,
    softLtvOpenWad: (73n * WAD) / 100n,
    softLtvClosedWad: (70n * WAD) / 100n,
    currentSoftLtvWad: (73n * WAD) / 100n,
    maxPositionUsdRaw: 500_000_000n,
    maxDeviationBps: 500,
    maxOracleAge: 2_700,
    totalSupplyRaw: 1_000_000_000n,
    totalBorrowRaw: 400_000_000n,
    borrowRatePerSecondWad: 3_000_000_000n,
    morphoFeeWad: 0n,
    oraclePriceE8: 74_562_000_000n,
    bidE8: 74_500_000_000n,
    askE8: 74_600_000_000n,
    session: "REGULAR",
    feedUpdatedAt: 1_791_876_162,
    publishedAt: 1_791_876_168,
    oracleStale: false,
    oracleHardStale: false,
    ...overrides,
  };
}

const session: ChainSession = {
  session: "REGULAR",
  closedRegime: false,
  nextCloseAt: null,
  preCloseWindow: 14_400,
  openingPaused: false,
  blockTime: 1_791_876_200,
};

function fakeReader(markets: MarketState[], s: ChainSession = session) {
  return { markets: async () => markets, session: async () => s } as unknown as ChainReader;
}

const empty = () => ({ prices: new Map(), markets: new Map(), session: null });

describe("stream events", () => {
  it("sends price, market and session on the first read and nothing when nothing changed", async () => {
    const first = await readEvents(fakeReader([market()]), empty());
    expect(first.events.map((e) => e.event).sort()).toEqual(["market", "price", "session"]);

    const second = await readEvents(fakeReader([market()], { ...session, blockTime: session.blockTime + 5 }), first.next);
    expect(second.events).toEqual([]);
  });

  it("sends one price per stock when its oracle write changes", async () => {
    const short = market({ info: { ...market().info, side: "short", marketId: `0x${"44".repeat(32)}` } });
    const first = await readEvents(fakeReader([market(), short]), empty());
    expect(first.events.filter((e) => e.event === "price")).toHaveLength(1);

    const moved = { oraclePriceE8: 74_600_000_000n, feedUpdatedAt: 1_791_876_762, publishedAt: 1_791_876_768 };
    const next = await readEvents(fakeReader([market(moved), { ...short, ...moved }]), first.next);
    expect(next.events).toEqual([expect.objectContaining({ event: "price", data: expect.objectContaining({ oraclePriceE8: "74600000000" }) })]);
  });

  it("carries the DEX mid price and its deviation from the oracle when one was measured", async () => {
    const { events } = await readEvents(fakeReader([market()]), empty(), async () => new Map([["QQQ", 73_816_000_000n]]));
    expect(events.find((e) => e.event === "price")?.data).toMatchObject({ dexMidPriceE8: "73816000000" });
    const noMid = await readEvents(fakeReader([market()]), empty());
    expect(noMid.events.find((e) => e.event === "price")?.data).toMatchObject({ dexMidPriceE8: null });
  });

  it("sends the session when the regime changes", async () => {
    const first = await readEvents(fakeReader([market()]), empty());
    const next = await readEvents(fakeReader([market()], { ...session, closedRegime: true }), first.next);
    expect(next.events.map((e) => e.event)).toEqual(["session"]);
  });
});

describe("cache", () => {
  it("shares one load between callers and reloads after the TTL", async () => {
    let now = 0;
    let loads = 0;
    const cached = createCache(() => now);
    const load = async () => ++loads;

    expect(await Promise.all([cached("k", 1_000, load), cached("k", 1_000, load)])).toEqual([1, 1]);
    now = 999;
    expect(await cached("k", 1_000, load)).toBe(1);
    now = 1_001;
    expect(await cached("k", 1_000, load)).toBe(2);
  });

  it("does not keep a failed load", async () => {
    const cached = createCache();
    await expect(cached("k", 1_000, async () => Promise.reject(new Error("rpc down")))).rejects.toThrow("rpc down");
    expect(await cached("k", 1_000, async () => 7)).toBe(7);
  });
});
