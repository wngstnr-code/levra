import { test as base, type Page } from "@playwright/test";

/** Sample answers in the shared API shapes. Test data only; the app never ships with any. */
const QQQ = "0x1446501E886c7f830DB9b494A1890cBCCC072f57";
const HOOD = "0x5a4860adDCc094FcE026384caeEcb1e634DD9af4";
const BIL = "0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const id = (n: string) => `0x${n.repeat(64)}`;

function market(symbol: string, name: string, token: string, side: "long" | "short", o: { price: string; lltv: string; soft: string; closed: string; lev: number; cap: string; dev: number }) {
  return {
    symbol,
    name,
    stockToken: token,
    side,
    marketId: id(symbol === "QQQ" ? (side === "long" ? "1" : "2") : symbol === "HOOD" ? (side === "long" ? "3" : "4") : "5"),
    collateralToken: side === "long" ? token : USDC,
    loanToken: side === "long" ? USDC : token,
    enabled: true,
    oraclePriceE8: o.price,
    oracleFeedUpdatedAt: Math.floor(Date.now() / 1000) - 960,
    oraclePublishedAt: Math.floor(Date.now() / 1000) - 240,
    oracleStale: false,
    dexMidPriceE8: o.price,
    dexDeviationBps: o.dev,
    lltvWad: o.lltv,
    softLtvOpenWad: o.soft,
    softLtvClosedWad: o.closed,
    currentSoftLtvWad: o.soft,
    maxLeverageE2: o.lev,
    maxPositionUsdRaw: o.cap,
    totalSupplyRaw: "48000000000",
    totalBorrowRaw: "35600000000",
    availableLiquidityRaw: "12400000000",
    utilizationWad: "741666666666666666",
    borrowApyWad: "62000000000000000",
    supplyApyWad: "41000000000000000",
  };
}

export const markets = [
  market("QQQ", "Invesco QQQ", QQQ, "long", { price: "74145000000", lltv: "770000000000000000", soft: "730000000000000000", closed: "700000000000000000", lev: 370, cap: "500000000", dev: -260 }),
  market("QQQ", "Invesco QQQ", QQQ, "short", { price: "74145000000", lltv: "770000000000000000", soft: "730000000000000000", closed: "700000000000000000", lev: 270, cap: "500000000", dev: -260 }),
  market("HOOD", "Robinhood", HOOD, "long", { price: "10875000000", lltv: "625000000000000000", soft: "580000000000000000", closed: "500000000000000000", lev: 240, cap: "1000000000", dev: 710 }),
  market("HOOD", "Robinhood", HOOD, "short", { price: "10875000000", lltv: "625000000000000000", soft: "580000000000000000", closed: "500000000000000000", lev: 140, cap: "1000000000", dev: 710 }),
  market("BIL", "SPDR 1-3M T-Bill", BIL, "long", { price: "9151000000", lltv: "915000000000000000", soft: "900000000000000000", closed: "900000000000000000", lev: 1000, cap: "1000000000", dev: 10 }),
];

const now = () => Math.floor(Date.now() / 1000);
export const session = () => ({ session: "PRE_MARKET", closedRegime: false, nextCloseAt: now() + 3 * 86400, nextOpenAt: null, updatedAt: now() });
export const status = (stale = false) => ({
  oracle: [{ symbol: "QQQ", publishedAt: now() - 240, ageSeconds: 240, stale }],
  keepers: [{ name: "oracleMonitor", lastHeartbeatAt: now() - 30, healthy: true }],
  indexer: { lastBlock: 100, chainHead: 102, lagBlocks: 2 },
  api: { version: "e2e" },
});
export const detail = () => ({
  symbol: "QQQ",
  name: "Invesco QQQ",
  stockToken: QQQ,
  session: session(),
  markets: markets.filter((m) => m.symbol === "QQQ"),
  depth: [
    { direction: "buy", sizeUsdRaw: "100000000", priceImpactBps: 40, deviationBps: -220, measuredAt: now() - 720 },
    { direction: "sell", sizeUsdRaw: "100000000", priceImpactBps: 50, deviationBps: -310, measuredAt: now() - 720 },
  ],
  rateHistory: [0, 1, 2, 3].map((i) => ({ marketId: id("1"), timestamp: now() - (3 - i) * 86400, borrowApyWad: String(50_000_000_000_000_000 + i * 4_000_000_000_000_000), supplyApyWad: "41000000000000000", utilizationWad: "741666666666666666" })),
  deviationHistory: [0, 1, 2].map((i) => ({ timestamp: now() - (2 - i) * 3600, oraclePriceE8: "74145000000", dexMidPriceE8: "72217000000", deviationBps: -200 - i * 30 })),
});

type Answers = { eligible?: boolean; stale?: boolean; gateOff?: boolean };

/** Answers the fake service address and keeps chain calls out, so each test only sees its own data. */
export async function mockService(page: Page, a: Answers = {}) {
  await page.route(/monad\.xyz/, (r) => r.abort());
  await page.route("http://api.levra.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/v1/markets") return json({ session: session(), markets });
    if (path === "/v1/session") return json(session());
    if (path === "/v1/status") return json(status(a.stale));
    if (path === "/v1/markets/QQQ") return json(detail());
    if (path === "/v1/eligibility" && !a.gateOff) return json({ eligible: a.eligible ?? true, reason: a.eligible === false ? "REGION_BLOCKED" : null, termsVersion: "2026-10-13", termsAccepted: null });
    if (path === "/v1/earn") return json({ options: [] });
    if (path === "/v1/stream") return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Not in this test" } }) });
  });
}

export const test = base;
export { expect } from "@playwright/test";
