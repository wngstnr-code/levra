import { createDb, marketTrades, morphoEvents, routerEvents, runMigrations, vaultEvents, walletCounts } from "@levra/db";
import type { EarnOption } from "@levra/shared/api";
import { statsResponse } from "@levra/shared/api";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { MarketState } from "../src/chain/reader";
import { buildStats } from "../src/stats/stats";

const L = `0x${"11".repeat(32)}`;
const S = `0x${"22".repeat(32)}`;
const SHARE = 100_000_000n; // a Base stock has 8 decimals
const PRICE = 15_000_000_000n; // $150
const market = (marketId: string, side: "long" | "short", totalBorrowRaw = 0n) =>
  ({ info: { marketId, side, stock: { decimals: 8 } }, oraclePriceE8: PRICE, totalBorrowRaw }) as unknown as MarketState;
const notional = (stock: bigint, priceE8: bigint) => stock * priceE8;
const zero = { collateralTimesPrice: 0n, debtTimesPrice: 0n };

describe("stats (BE-79), by hand", () => {
  const stats = buildStats({
    chainId: 8453,
    usdcDecimals: 6,
    markets: [market(L, "long"), market(S, "short", (4n * SHARE) / 10n)],
    positions: [
      { user: "0xa", marketId: L, collateral: SHARE, borrowShares: 1n },
      { user: "0xb", marketId: L, collateral: SHARE / 2n, borrowShares: 1n },
      { user: "0xc", marketId: S, collateral: 500_000_000n, borrowShares: 1n },
      { user: "0xd", marketId: `0x${"33".repeat(32)}`, collateral: SHARE, borrowShares: 0n },
    ],
    trades: [
      // Long: 2 shares at $150 in all, 1 of them this week. The debt side of a long is USDC and must not count.
      { marketId: L, trades: 3, total: { collateralTimesPrice: notional(2n * SHARE, PRICE), debtTimesPrice: 10n ** 30n }, last7d: { collateralTimesPrice: notional(SHARE, PRICE), debtTimesPrice: 1n }, last24h: zero },
      // Short: 1 share bought back at $160, today. The collateral side of a short is USDC and must not count.
      { marketId: S, trades: 1, total: { collateralTimesPrice: 10n ** 30n, debtTimesPrice: notional(SHARE, 16_000_000_000n) }, last7d: { collateralTimesPrice: 0n, debtTimesPrice: notional(SHARE, 16_000_000_000n) }, last24h: { collateralTimesPrice: 0n, debtTimesPrice: notional(SHARE, 16_000_000_000n) } },
    ],
    wallets: { total: 4, traders: 2, lenders: 3 },
    earnOptions: [
      { kind: "vault", marketId: null, totalSuppliedRaw: "1000000000" },
      { kind: "market", marketId: S, totalSuppliedRaw: (2n * SHARE).toString() },
    ] as EarnOption[],
    now: 1_795_400_000,
  });

  it("matches the response schema", () => {
    expect(statsResponse.parse(stats)).toEqual(stats);
  });

  it("long open interest: 1.5 shares of collateral at $150 = $225; short: 0.4 share borrowed = $60", () => {
    expect(stats.openInterest).toEqual({ longUsdRaw: "225000000", shortUsdRaw: "60000000", openPositions: 3 });
  });

  it("volume: the stock side of each trade, $300 + $160 in all, $150 + $160 this week, $160 today", () => {
    expect(stats.volume).toEqual({ totalUsdRaw: "460000000", last7dUsdRaw: "310000000", last24hUsdRaw: "160000000", trades: 4 });
  });

  it("Earn: $1,000 in the vault plus 2 shares lent at $150", () => {
    expect(stats.earn.suppliedUsdRaw).toBe("1300000000");
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("stats queries (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const CHAIN = 8453;
  const NOW = 1_795_400_000;
  const VAULT = "0x00000000000000000000000000000000000000aa";
  let n = 0;
  const at = (secondsAgo: number) => ({ blockNumber: BigInt(++n), blockTime: new Date((NOW - secondsAgo) * 1000), txHash: `0x${n.toString(16).padStart(64, "0")}`, logIndex: 0 });

  beforeEach(async () => {
    await runMigrations(url ?? "");
    await Promise.all([db.delete(routerEvents), db.delete(morphoEvents), db.delete(vaultEvents)]);
  });
  afterAll(() => close());

  it("sums each market's trades by window and counts traders and lenders once", async () => {
    await db.insert(routerEvents).values([
      { chainId: CHAIN, name: "PositionOpened", user: "0xa", marketId: L, args: { collateralDelta: SHARE.toString(), debtDelta: "50000000", execPriceE8: PRICE.toString() }, ...at(2 * 86_400) },
      { chainId: CHAIN, name: "PositionReduced", user: "0xa", marketId: L, args: { collateralDelta: (SHARE / 2n).toString(), debtDelta: "0", execPriceE8: "16000000000" }, ...at(3_600) },
      { chainId: CHAIN, name: "PositionOpened", user: "0xb", marketId: S, args: { collateralDelta: "200000000", debtDelta: SHARE.toString(), execPriceE8: PRICE.toString() }, ...at(10 * 86_400) },
      { chainId: CHAIN, name: "ProtectionSet", user: "0xc", marketId: L, args: { enabled: true }, ...at(60) },
      { chainId: 143, name: "PositionOpened", user: "0xz", marketId: L, args: { collateralDelta: "1", debtDelta: "1", execPriceE8: "1" }, ...at(60) },
    ]);
    await db.insert(vaultEvents).values([{ chainId: CHAIN, name: "Deposit", vault: VAULT, user: "0xd", args: { assets: "1" }, ...at(60) }]);
    await db.insert(morphoEvents).values([
      { chainId: CHAIN, name: "Supply", marketId: L, user: VAULT, args: { assets: "1" }, ...at(60) },
      { chainId: CHAIN, name: "Supply", marketId: S, user: "0xe", args: { assets: "1" }, ...at(60) },
      { chainId: CHAIN, name: "Supply", marketId: S, user: "0xa", args: { assets: "1" }, ...at(60) },
    ]);

    const trades = new Map((await marketTrades(db, CHAIN, NOW)).map((t) => [t.marketId, t]));
    expect(trades.get(L)).toEqual({
      marketId: L,
      trades: 2,
      total: { collateralTimesPrice: notional(SHARE, PRICE) + notional(SHARE / 2n, 16_000_000_000n), debtTimesPrice: 50_000_000n * PRICE },
      last7d: { collateralTimesPrice: notional(SHARE, PRICE) + notional(SHARE / 2n, 16_000_000_000n), debtTimesPrice: 50_000_000n * PRICE },
      last24h: { collateralTimesPrice: notional(SHARE / 2n, 16_000_000_000n), debtTimesPrice: 0n },
    });
    expect(trades.get(S)).toMatchObject({ trades: 1, total: { debtTimesPrice: notional(SHARE, PRICE) }, last7d: zero });
    expect(await walletCounts(db, CHAIN, [VAULT])).toEqual({ traders: 2, lenders: 3, total: 4 });
    expect(await walletCounts(db, CHAIN, [])).toMatchObject({ lenders: 4 });
  });
});
