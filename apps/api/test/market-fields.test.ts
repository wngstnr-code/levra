import { baseExternal, baseTokens, tokens } from "@levra/shared/addresses";
import { chainsResponse, market as marketSchema, marketsResponse } from "@levra/shared/api";
import { baseStocks, stocks } from "@levra/shared/markets";
import pino from "pino";
import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { ChainReader, MarketState } from "../src/chain/reader";
import { haltReasonsFor, marketRoutes, toApiMarket } from "../src/routes/markets";
import { Hono } from "hono";

const WAD = 10n ** 18n;

function state(stock: MarketState["info"]["stock"], extra: Partial<MarketState> = {}): MarketState {
  return {
    info: { symbol: stock.symbol, side: "long", marketId: `0x${"1a".repeat(32)}`, stock, collateralToken: stock.token, loanToken: stock.token, oracle: stock.token, lltv: "625000000000000000" },
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
    uiMultiplierWad: null,
    tokenPaused: false,
    ...extra,
  } as MarketState;
}

const session = async () => ({ session: "REGULAR", closedRegime: false, nextCloseAt: null, preCloseWindow: 1_800, openingPaused: false, blockTime: 1_791_880_700 });
const fakeReader = (chainId: number, markets: MarketState[]) =>
  ({ deployment: { chainId, router: zeroAddress, riskManager: zeroAddress, lens: zeroAddress, markets: [] }, markets: async () => markets, session }) as unknown as ChainReader;

describe("chain in the path (BE-70)", () => {
  const monad = fakeReader(143, [state(stocks.HOOD)]);
  const base = fakeReader(8453, [state(baseStocks.AAPL, { uiMultiplierWad: WAD })]);
  const app = createApp({ logger: pino({ level: "silent" }), reader: monad, otherChains: [base] });
  const get = async (path: string) => {
    const res = await app.request(path);
    return { status: res.status, body: await res.json() };
  };

  it("lists the chains and which of them are live", async () => {
    const { body } = await get("/v1/chains");
    expect(chainsResponse.parse(body)).toEqual({
      chains: [
        { chainId: 143, slug: "monad", name: "Monad", nativeSymbol: "MON", live: true },
        { chainId: 196, slug: "xlayer", name: "X Layer", nativeSymbol: "OKB", live: false },
        { chainId: 8453, slug: "base", name: "Base", nativeSymbol: "ETH", live: true },
      ],
      defaultChainId: 143,
    });
  });

  it("serves each chain under its ID, and Monad also without one", async () => {
    const symbols = async (path: string) => marketsResponse.parse((await get(path)).body).markets.map((m) => m.symbol);
    expect(await symbols("/v1/markets")).toEqual(["HOOD"]);
    expect(await symbols("/v1/143/markets")).toEqual(["HOOD"]);
    expect(await symbols("/v1/8453/markets")).toEqual(["AAPL"]);
    expect((await get("/v1/8453/markets/aapl")).body).toMatchObject({ symbol: "AAPL", name: "Apple Inc.", stockToken: baseStocks.AAPL.token });
    expect((await get("/v1/8453/markets/HOOD")).status).toBe(404);
  });

  it("gives each chain its own Morpho and USDC in the config", async () => {
    expect((await get("/v1/8453/config")).body).toMatchObject({ chainId: 8453, morpho: baseExternal.morpho, usdc: baseTokens.USDC.address });
    expect((await get("/v1/config")).body).toMatchObject({ chainId: 143, usdc: tokens.USDC.address });
  });

  it("answers 404 for an unknown chain, a chain that is not live and a global route under a chain", async () => {
    expect(await get("/v1/1/markets")).toMatchObject({ status: 404, body: { error: { code: "NOT_FOUND" } } });
    expect(await get("/v1/196/markets")).toMatchObject({ status: 404, body: { error: { code: "NOT_FOUND", details: { chainId: 196, live: false } } } });
    expect((await get("/v1/8453/health")).status).toBe(404);
    expect((await get("/v1/8453/nothing")).status).toBe(404);
  });

  it("has no quotes on a chain without a swap provider yet", async () => {
    const res = await app.request("/v1/8453/quote/open", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(404);
  });
});

describe("market fields for every chain (BE-70)", () => {
  it("marks a Monad stock as Anchored, with no multiplier and no pause flag", () => {
    const m = toApiMarket(state(stocks.HOOD));
    expect(m).toMatchObject({ oracleKind: "anchored", uiMultiplierWad: null, tokenPaused: false });
    expect(marketSchema.parse(m)).toEqual(m);
  });

  it("marks a Base stock as Chainlink and passes on its registry multiplier and pause", () => {
    const m = toApiMarket(state(baseStocks.AAPL, { uiMultiplierWad: 1_000_500_000_000_000_000n, tokenPaused: true }));
    expect(m).toMatchObject({ oracleKind: "chainlink", uiMultiplierWad: "1000500000000000000", tokenPaused: true });
    expect(marketSchema.parse(m)).toEqual(m);
  });
});

describe("issuer blocks on the markets (BE-75)", () => {
  const blocks = [
    { symbol: "AAPL", message: "AAPLc transfers are paused by the issuer" },
    { symbol: null, message: "Circle blacklists router for USDC" },
  ];

  it("gives a stock its own blocks and the chain-wide ones, and nothing when there are none", () => {
    expect(haltReasonsFor(blocks, "AAPL")).toEqual(["AAPLc transfers are paused by the issuer", "Circle blacklists router for USDC"]);
    expect(haltReasonsFor(blocks, "NVDA")).toEqual(["Circle blacklists router for USDC"]);
    expect(haltReasonsFor([], "AAPL")).toEqual([]);
  });

  it("serves them in the market list and the market detail", async () => {
    const reader = fakeReader(8453, [state(baseStocks.AAPL), state(baseStocks.NVDA)]);
    const app = new Hono().route("/", marketRoutes(reader, undefined, undefined, undefined, async () => blocks));
    const list = marketsResponse.parse(await (await app.request("/v1/markets")).json());
    expect(list.markets.map((m) => [m.symbol, m.haltReasons])).toEqual([
      ["AAPL", ["AAPLc transfers are paused by the issuer", "Circle blacklists router for USDC"]],
      ["NVDA", ["Circle blacklists router for USDC"]],
    ]);
    const detail = (await (await app.request("/v1/markets/NVDA")).json()) as { markets: { haltReasons: string[] }[] };
    expect(detail.markets[0]!.haltReasons).toEqual(["Circle blacklists router for USDC"]);
  });

  it("sends an empty list without a database", () => {
    expect(toApiMarket(state(stocks.HOOD)).haltReasons).toEqual([]);
  });
});
