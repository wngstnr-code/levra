import { describe, expect, it } from "vitest";
import {
  account,
  apiError,
  depositStatus,
  endpoints,
  market,
  quoteCloseRequest,
  quoteOpenRequest,
  quoteOpenResponse,
  rawAmount,
  sessionInfo,
  signedRawAmount,
  symbol,
  type Hex,
  type Market,
  type QuoteOpenRequest,
} from "./index";

const user = "0x1111111111111111111111111111111111111111";
const usdc = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const aQQQ = "0x1446501E886c7f830DB9b494A1890cBCCC072f57";
const router = "0x2222222222222222222222222222222222222222";
const marketId: Hex = `0x${"ab".repeat(32)}`;

const sampleMarket = {
  symbol: "QQQ",
  name: "Invesco QQQ Trust",
  stockToken: aQQQ,
  side: "long",
  marketId,
  collateralToken: aQQQ,
  loanToken: usdc,
  enabled: true,
  oraclePriceE8: "74562000000",
  oraclePublishedAt: 1791871377,
  oracleStale: false,
  dexMidPriceE8: "72628000000",
  dexDeviationBps: -260,
  lltvWad: "770000000000000000",
  softLtvOpenWad: "730000000000000000",
  softLtvClosedWad: "700000000000000000",
  currentSoftLtvWad: "730000000000000000",
  maxLeverageE2: 370,
  maxPositionUsdRaw: "500000000",
  totalSupplyRaw: "10000000000",
  totalBorrowRaw: "2500000000",
  availableLiquidityRaw: "7500000000",
  utilizationWad: "250000000000000000",
  borrowApyWad: "60000000000000000",
  supplyApyWad: "15000000000000000",
} satisfies Market;

const sampleOpenRequest = {
  user,
  symbol: "QQQ",
  side: "long",
  marginRaw: "100000000",
  leverageE2: 200,
  slippageBps: 50,
} satisfies QuoteOpenRequest;

describe("primitives", () => {
  it("accepts integer strings and rejects everything else for raw amounts", () => {
    expect(rawAmount.safeParse("100000000").success).toBe(true);
    expect(rawAmount.safeParse("0").success).toBe(true);
    expect(rawAmount.safeParse(100000000).success).toBe(false);
    expect(rawAmount.safeParse("1.5").success).toBe(false);
    expect(rawAmount.safeParse("-1").success).toBe(false);
    expect(rawAmount.safeParse("007").success).toBe(false);
  });

  it("allows a minus sign only on signed amounts", () => {
    expect(signedRawAmount.safeParse("-2500000").success).toBe(true);
    expect(signedRawAmount.safeParse("-0").success).toBe(false);
  });

  it("requires uppercase symbols without the token prefix", () => {
    expect(symbol.safeParse("QQQ").success).toBe(true);
    expect(symbol.safeParse("aQQQ").success).toBe(false);
    expect(symbol.safeParse("qqq").success).toBe(false);
  });
});

describe("market", () => {
  it("parses a full market", () => {
    expect(market.parse(sampleMarket)).toEqual(sampleMarket);
  });

  it("allows a missing DEX price", () => {
    expect(market.safeParse({ ...sampleMarket, dexMidPriceE8: null, dexDeviationBps: null }).success).toBe(true);
  });

  it("rejects a bad address and a short market id", () => {
    expect(market.safeParse({ ...sampleMarket, stockToken: "0x1234" }).success).toBe(false);
    expect(market.safeParse({ ...sampleMarket, marketId: "0xabcd" }).success).toBe(false);
  });
});

describe("quotes", () => {
  it("parses an open request with and without signatures", () => {
    expect(quoteOpenRequest.safeParse(sampleOpenRequest).success).toBe(true);
    const signed = {
      ...sampleOpenRequest,
      signatures: [{ type: "approve", signature: "0xabcdef", deadline: 1791875000 }],
    };
    expect(quoteOpenRequest.safeParse(signed).success).toBe(true);
  });

  it("rejects leverage of zero, fractional leverage and slippage above 100%", () => {
    expect(quoteOpenRequest.safeParse({ ...sampleOpenRequest, leverageE2: 0 }).success).toBe(false);
    expect(quoteOpenRequest.safeParse({ ...sampleOpenRequest, leverageE2: 2.5 }).success).toBe(false);
    expect(quoteOpenRequest.safeParse({ ...sampleOpenRequest, slippageBps: 10_001 }).success).toBe(false);
  });

  it("rejects an unknown side", () => {
    expect(quoteOpenRequest.safeParse({ ...sampleOpenRequest, side: "flat" }).success).toBe(false);
  });

  it("parses an open response", () => {
    const response = {
      quoteId: "q_1",
      expiresAt: 1791871400,
      market: sampleMarket,
      preview: {
        stockAmountRaw: "268000000000000000",
        collateralRaw: "268000000000000000",
        debtRaw: "100000000",
        execPriceE8: "74400000000",
        oraclePriceE8: "74562000000",
        deviationBps: -22,
        priceImpactBps: 30,
        feeRaw: "200000",
        ltvAfterWad: "500400000000000000",
        liqPriceE8: "48460000000",
        liqDistanceBps: -3500,
        borrowApyWad: "60000000000000000",
        gapScenarios: [{ label: "Worst five-year gap", moveBps: -540, ltvWad: "529000000000000000", liquidated: false }],
      },
      requirements: [{ type: "morphoAuthorization", satisfied: false, typedData: { primaryType: "Authorization" } }],
      tx: { to: router, data: "0x1234", value: "0", gasLimit: "900000" },
      warnings: [{ code: "HIGH_PRICE_IMPACT", severity: "warn", message: "Price impact is above 0.25%" }],
    };
    expect(quoteOpenResponse.safeParse(response).success).toBe(true);
    expect(quoteOpenResponse.safeParse({ ...response, tx: { ...response.tx, gasLimit: 900000 } }).success).toBe(false);
  });

  it("parses a close request", () => {
    const request = { user, marketId, fractionWad: "1000000000000000000", slippageBps: 50 };
    expect(quoteCloseRequest.safeParse(request).success).toBe(true);
  });
});

describe("account", () => {
  it("allows negative equity and profit", () => {
    const value = {
      address: user,
      positions: [],
      totals: { equityUsdRaw: "-1500000", debtUsdRaw: "100000000", unrealizedPnlUsdRaw: "-2500000" },
      walletBalances: [{ token: usdc, symbol: "USDC", balanceRaw: "42000000" }],
      morphoAuthorized: true,
      updatedAtBlock: 112965917,
    };
    expect(account.safeParse(value).success).toBe(true);
    expect(account.safeParse({ ...value, totals: { ...value.totals, debtUsdRaw: "-1" } }).success).toBe(false);
  });
});

describe("other shapes", () => {
  it("parses session info with unknown next times", () => {
    const value = { session: "CLOSED", closedRegime: true, nextCloseAt: null, nextOpenAt: 1791900000, updatedAt: 1791871377 };
    expect(sessionInfo.safeParse(value).success).toBe(true);
    expect(sessionInfo.safeParse({ ...value, session: "LUNCH" }).success).toBe(false);
  });

  it("parses a deposit status and rejects an unknown state", () => {
    const value = {
      id: "d_1",
      status: "PROCESSING",
      originTxHash: "5h3k",
      destinationTxHash: null,
      amountOutRaw: null,
      updatedAt: 1791871377,
    };
    expect(depositStatus.safeParse(value).success).toBe(true);
    expect(depositStatus.safeParse({ ...value, status: "DONE" }).success).toBe(false);
  });

  it("parses an error and rejects an unknown code", () => {
    expect(apiError.safeParse({ error: { code: "NO_ROUTE", message: "No route found" } }).success).toBe(true);
    expect(apiError.safeParse({ error: { code: "TEAPOT", message: "?" } }).success).toBe(false);
  });
});

describe("endpoints", () => {
  it("keeps every path under /v1 and unique per method", () => {
    const seen = new Set<string>();
    for (const endpoint of Object.values(endpoints)) {
      expect(endpoint.path.startsWith("/v1/")).toBe(true);
      const key = `${endpoint.method} ${endpoint.path}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(23);
  });
});
