import { external, tokens } from "@levra/shared/addresses";
import type { ConfigResponse, Market, MarketsResponse, SessionInfo } from "@levra/shared/api";
import { borrowApyWad, maxLeverageE2, supplyApyWad, utilizationWad } from "@levra/shared/math";
import { Hono } from "hono";
import type { ChainReader, ChainSession, MarketState } from "../chain/reader";
import { upstream } from "../errors";

export function toApiMarket(m: MarketState): Market {
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
    // Filled from the DEX depth measurements of BE-04. Null until they exist, never estimated.
    dexMidPriceE8: null,
    dexDeviationBps: null,
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

export function marketRoutes(reader: ChainReader) {
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
    const [session, markets] = await Promise.all([upstream(reader.session), upstream(reader.markets)]);
    return c.json({ session: toSessionInfo(session), markets: markets.map(toApiMarket) } satisfies MarketsResponse);
  });

  return app;
}
