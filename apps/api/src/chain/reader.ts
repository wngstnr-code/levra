import { external } from "@levra/shared/addresses";
import { lensAbi, morphoAbi, riskManagerAbi } from "@levra/shared/abis";
import type { SessionName } from "@levra/shared/api";
import type { Deployment } from "@levra/shared/deployments";
import { listMarkets, type MarketInfo } from "@levra/shared/markets";
import type { Address, Hex, PublicClient } from "viem";
import { createCache } from "./cache";

const sessions: SessionName[] = ["UNKNOWN", "PRE_MARKET", "REGULAR", "POST_MARKET", "OVERNIGHT", "CLOSED"];

/** One market as read from the chain. Ratios WAD, prices E8, amounts in base units, times unix seconds. */
export type MarketState = {
  info: MarketInfo;
  enabled: boolean;
  lltvWad: bigint;
  softLtvOpenWad: bigint;
  softLtvClosedWad: bigint;
  currentSoftLtvWad: bigint;
  maxPositionUsdRaw: bigint;
  maxDeviationBps: number;
  maxOracleAge: number;
  totalSupplyRaw: bigint;
  totalBorrowRaw: bigint;
  borrowRatePerSecondWad: bigint;
  morphoFeeWad: bigint;
  oraclePriceE8: bigint;
  session: SessionName;
  feedUpdatedAt: number;
  publishedAt: number;
  /** SessionOracle's hard check, or the RiskManager open check: older than `maxOracleAge` outside `CLOSED`. */
  oracleStale: boolean;
};

export type ChainSession = {
  session: SessionName;
  closedRegime: boolean;
  nextCloseAt: number | null;
  preCloseWindow: number;
  openingPaused: boolean;
  blockTime: number;
};

export type PositionState = {
  marketId: Hex;
  side: "long" | "short";
  collateralRaw: bigint;
  debtRaw: bigint;
  ltvWad: bigint;
  softLtvWad: bigint;
  lltvWad: bigint;
  liqPriceE8: bigint;
  protection: boolean;
};

export type ChainReader = ReturnType<typeof createChainReader>;

/** TTLs in milliseconds. Monad blocks are 0.4 s and oracle writes about 10 minutes apart. */
const TTL = { markets: 2_000, session: 2_000, positions: 1_000, block: 1_000 } as const;

/** The only place the API talks to the RPC endpoint. */
export function createChainReader(client: PublicClient, deployment: Deployment) {
  const cached = createCache();
  const marketsById = new Map(listMarkets(deployment).map((m) => [m.marketId.toLowerCase(), m]));
  const sideName = (side: number) => (side === 0 ? "long" : "short") as "long" | "short";

  function findInfo(marketId: Hex): MarketInfo {
    const info = marketsById.get(marketId.toLowerCase());
    if (!info) throw new Error(`Market ${marketId} is on chain but not in the deployment file`);
    return info;
  }

  const latestBlock = () =>
    cached("block", TTL.block, async () => {
      const block = await client.getBlock({ blockTag: "latest" });
      return { number: block.number, time: Number(block.timestamp) };
    });

  const markets = () =>
    cached("markets", TTL.markets, async (): Promise<MarketState[]> => {
      const [views, block] = await Promise.all([
        client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getMarkets" }),
        latestBlock(),
      ]);
      const extra = await client.multicall({
        allowFailure: false,
        contracts: views.flatMap((v) => [
          { address: deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [v.marketId] } as const,
          { address: external.morpho, abi: morphoAbi, functionName: "market", args: [v.marketId] } as const,
        ]),
      });

      return views.map((v, i) => {
        const config = extra[2 * i] as { maxDeviationBps: number; maxOracleAge: number };
        const { fee } = extra[2 * i + 1] as { fee: bigint };
        const session = sessions[v.session] ?? "UNKNOWN";
        const feedUpdatedAt = Number(v.feedUpdatedAt);
        const tooOldToOpen = session !== "CLOSED" && block.time > feedUpdatedAt + config.maxOracleAge;
        return {
          info: findInfo(v.marketId),
          enabled: v.enabled,
          lltvWad: v.lltv,
          softLtvOpenWad: v.softLtvOpen,
          softLtvClosedWad: v.softLtvClosed,
          currentSoftLtvWad: v.currentSoftLtv,
          maxPositionUsdRaw: v.maxPositionUsd,
          maxDeviationBps: config.maxDeviationBps,
          maxOracleAge: config.maxOracleAge,
          totalSupplyRaw: v.totalSupplyAssets,
          totalBorrowRaw: v.totalBorrowAssets,
          borrowRatePerSecondWad: v.borrowRatePerSecond,
          morphoFeeWad: fee,
          oraclePriceE8: v.priceE8,
          session,
          feedUpdatedAt,
          publishedAt: Number(v.publishedAt),
          oracleStale: v.stale || tooOldToOpen,
        };
      });
    });

  const session = () =>
    cached("session", TTL.session, async (): Promise<ChainSession> => {
      const [closedRegime, nextCloseAt, preCloseWindow, openingPaused] = await client.multicall({
        allowFailure: false,
        contracts: [
          { address: deployment.riskManager, abi: riskManagerAbi, functionName: "isClosedRegime" },
          { address: deployment.riskManager, abi: riskManagerAbi, functionName: "nextCloseAt" },
          { address: deployment.riskManager, abi: riskManagerAbi, functionName: "preCloseWindow" },
          { address: deployment.riskManager, abi: riskManagerAbi, functionName: "openingPaused" },
        ],
      });
      const [all, block] = await Promise.all([markets(), latestBlock()]);
      return {
        session: all[0]?.session ?? "UNKNOWN",
        closedRegime,
        nextCloseAt: nextCloseAt === 0n ? null : Number(nextCloseAt),
        preCloseWindow: Number(preCloseWindow),
        openingPaused,
        blockTime: block.time,
      };
    });

  const positions = (user: Address) =>
    cached(`positions:${user.toLowerCase()}`, TTL.positions, async (): Promise<PositionState[]> => {
      const views = await client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getPositions", args: [user] });
      return views.map((v) => ({
        marketId: v.marketId,
        side: sideName(v.side),
        collateralRaw: v.collateral,
        debtRaw: v.debt,
        ltvWad: v.ltv,
        softLtvWad: v.softLtv,
        lltvWad: v.lltv,
        liqPriceE8: v.liqPriceE8,
        protection: v.protection,
      }));
    });

  return { deployment, markets, session, positions, latestBlock, client };
}
