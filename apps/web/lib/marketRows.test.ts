import type { Market } from "@levra/shared/api";
import { describe, expect, it } from "vitest";
import { buildMarketRows } from "./marketRows";

const qqqLong: Market = {
  symbol: "QQQ",
  name: "Invesco QQQ",
  stockToken: "0x1446501E886c7f830DB9b494A1890cBCCC072f57",
  side: "long",
  marketId: "0x1111111111111111111111111111111111111111111111111111111111111111",
  collateralToken: "0x1446501E886c7f830DB9b494A1890cBCCC072f57",
  loanToken: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  enabled: true,
  oraclePriceE8: "74145000000",
  oracleFeedUpdatedAt: 1791880000,
  oraclePublishedAt: 1791880600,
  oracleStale: false,
  dexMidPriceE8: "72217000000",
  dexDeviationBps: -260,
  lltvWad: "770000000000000000",
  softLtvOpenWad: "730000000000000000",
  softLtvClosedWad: "700000000000000000",
  currentSoftLtvWad: "730000000000000000",
  maxLeverageE2: 370,
  maxPositionUsdRaw: "500000000",
  totalSupplyRaw: "48000000000",
  totalBorrowRaw: "35600000000",
  availableLiquidityRaw: "12400000000",
  utilizationWad: "741666666666666666",
  borrowApyWad: "62000000000000000",
  supplyApyWad: "41000000000000000",
};

describe("buildMarketRows", () => {
  it("lists every stock in the shared list", () => {
    expect(buildMarketRows(undefined, {}).map((r) => r.stock.symbol)).toEqual(["QQQ", "HOOD", "BIL"]);
  });

  it("prefers the service price and keeps the oracle session", () => {
    const rows = buildMarketRows([qqqLong], { QQQ: { priceE8: 1n, feedUpdatedAt: 5, session: "PRE_MARKET" } });
    expect(rows[0]).toMatchObject({ priceE8: 74_145_000_000n, feedUpdatedAt: 1791880000, session: "PRE_MARKET", deviationBps: -260 });
    expect(rows[0]!.long?.marketId).toBe(qqqLong.marketId);
    expect(rows[0]!.short).toBeNull();
  });

  it("falls back to the oracle when the service has nothing", () => {
    const rows = buildMarketRows(undefined, { HOOD: { priceE8: 10_875_000_000n, feedUpdatedAt: 7, session: "CLOSED" } });
    expect(rows[1]).toMatchObject({ priceE8: 10_875_000_000n, feedUpdatedAt: 7, session: "CLOSED", long: null, deviationBps: null });
  });
});
