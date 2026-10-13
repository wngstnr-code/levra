import { external, tokens } from "@levra/shared/addresses";
import type { ConfigResponse, Market, MarketsResponse, SessionInfo } from "@levra/shared/api";
import { borrowApyWad, maxLeverageE2, signedDeviationBps, supplyApyWad, utilizationWad } from "@levra/shared/math";
import { Hono } from "hono";
import type { ChainReader, ChainSession, MarketState } from "../chain/reader";
import { upstream } from "../errors";

/** `dexMidE8` comes from the depth keeper (BE-04); without a recent measurement the DEX fields stay null. */
export function toApiMarket(m: MarketState, dexMidE8?: bigint): Market {
  const utilization = utilizationWad(m.totalBorrowRaw, m.totalSupplyRaw);
  const borrowApy = borrowApyWad(m.borrowRatePerSecondWad);
  const available = m.totalSupplyRaw > m.totalBorrowRaw ? m.totalSupplyRaw - m.totalBorrowRaw : 0n;
  return {
    symbol: m.info.symbol,
    name: m.info.stock.name,
    stockToken: m.info.stock.token,
    side: m.info.side,
    marketId: m.info.marketId,
    collateralToken: m.info.collateralToken,
    loanToken: m.info.loanToken,
    enabled: m.enabled,
    oraclePriceE8: m.oraclePriceE8.toString(),
    oracleFeedUpdatedAt: m.feedUpdatedAt,
    oraclePublishedAt: m.publishedAt,
    oracleStale: m.oracleStale,
    dexMidPriceE8: dexMidE8 === undefined ? null : dexMidE8.toString(),
    dexDeviationBps: dexMidE8 === undefined ? null : signedDeviationBps(dexMidE8, m.oraclePriceE8),
    lltvWad: m.lltvWad.toString(),
    softLtvOpenWad: m.softLtvOpenWad.toString(),
    softLtvClosedWad: m.softLtvClosedWad.toString(),
    currentSoftLtvWad: m.currentSoftLtvWad.toString(),
    maxLeverageE2: maxLeverageE2(m.info.side, m.currentSoftLtvWad),
    maxPositionUsdRaw: m.maxPositionUsdRaw.toString(),
    totalSupplyRaw: m.totalSupplyRaw.toString(),
    totalBorrowRaw: m.totalBorrowRaw.toString(),
    availableLiquidityRaw: available.toString(),
    utilizationWad: utilization.toString(),
    borrowApyWad: borrowApy.toString(),
    supplyApyWad: supplyApyWad(borrowApy, utilization, m.morphoFeeWad).toString(),
  };
}

export function toSessionInfo(s: ChainSession): SessionInfo {
  return {
    session: s.session,
    closedRegime: s.closedRegime,
    nextCloseAt: s.nextCloseAt,
    // Comes from the exchange calendar (BE-30). The chain does not know the next open.
    nextOpenAt: null,
    updatedAt: s.blockTime,
  };
}

/** DEX mid prices per stock symbol. Empty when there is no recent measurement. */
export type DexMids = () => Promise<Map<string, bigint>>;
export const noDexMids: DexMids = async () => new Map();

export function marketRoutes(reader: ChainReader, dexMids: DexMids = noDexMids) {
  const app = new Hono();
  const { deployment } = reader;

  app.get("/v1/config", (c) =>
    c.json({
      chainId: deployment.chainId,
      morpho: external.morpho,
      usdc: tokens.USDC.address,
      router: deployment.router,
      riskManager: deployment.riskManager,
      lens: deployment.lens,
      markets: deployment.markets,
    } satisfies ConfigResponse),
  );

  app.get("/v1/session", async (c) => c.json(toSessionInfo(await upstream(reader.session))));

  app.get("/v1/markets", async (c) => {
    const [session, markets, mids] = await Promise.all([upstream(reader.session), upstream(reader.markets), dexMids()]);
    return c.json({ session: toSessionInfo(session), markets: markets.map((m) => toApiMarket(m, mids.get(m.info.symbol))) } satisfies MarketsResponse);
  });

  return app;
}
