import { external } from "@levra/shared/addresses";
import { lensAbi, marginRouterAbi, morphoAbi, riskManagerAbi, sessionOracleAbi } from "@levra/shared/abis";
import type { SessionName } from "@levra/shared/api";
import type { Deployment } from "@levra/shared/deployments";
import { listMarkets, type MarketInfo } from "@levra/shared/markets";
import { erc20Abi, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { createCache } from "./cache";

/**
 * Standard ERC-2612 reads plus `version()`, which USDC on Monad has (05).
 * Temporary until the ABI export in packages/shared includes IERC20Permit (requested from Wangsit).
 */
const permitAbi = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function nonces(address owner) view returns (uint256)",
]);

export type UserState = {
  balance: bigint;
  allowance: bigint;
  permitNonce: bigint;
  authorized: boolean;
  morphoNonce: bigint;
};

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
  /** Zero when the oracle has no positive value. */
  bidE8: bigint;
  askE8: bigint;
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
const TTL = { markets: 2_000, session: 2_000, positions: 1_000, block: 1_000, fees: 30_000 } as const;

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
      const infos = views.map((v) => findInfo(v.marketId));
      const extra = await client.multicall({
        allowFailure: true,
        contracts: views.flatMap((v, i) => [
          { address: deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [v.marketId] } as const,
          { address: external.morpho, abi: morphoAbi, functionName: "market", args: [v.marketId] } as const,
          { address: infos[i]!.oracle, abi: sessionOracleAbi, functionName: "snapshot" } as const,
        ]),
      });
      const ok = <T>(r: (typeof extra)[number]): T => {
        if (r.status !== "success") throw r.error;
        return r.result as T;
      };

      return views.map((v, i) => {
        const config = ok<{ maxDeviationBps: number; maxOracleAge: number }>(extra[3 * i]!);
        const { fee } = ok<{ fee: bigint }>(extra[3 * i + 1]!);
        // snapshot() reverts on a non-positive price; Lens then reports the market as stale.
        const snapshot = extra[3 * i + 2]!;
        const [, bidE8, askE8] = snapshot.status === "success" ? (snapshot.result as readonly bigint[]) : [0n, 0n, 0n];
        const session = sessions[v.session] ?? "UNKNOWN";
        const feedUpdatedAt = Number(v.feedUpdatedAt);
        const tooOldToOpen = session !== "CLOSED" && block.time > feedUpdatedAt + config.maxOracleAge;
        return {
          info: infos[i]!,
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
          bidE8: bidE8 ?? 0n,
          askE8: askE8 ?? 0n,
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

  const routerFees = () =>
    cached("routerFees", TTL.fees, async () => {
      const [feeBps, keeperFeeBps] = await client.multicall({
        allowFailure: false,
        contracts: [
          { address: deployment.router, abi: marginRouterAbi, functionName: "feeBps" },
          { address: deployment.router, abi: marginRouterAbi, functionName: "keeperFeeBps" },
        ],
      });
      return { feeBps, keeperFeeBps };
    });

  /** EIP-712 domain fields of a token with `permit`. They never change, so they are read once. */
  const permitDomain = (token: Address) =>
    cached(`permitDomain:${token.toLowerCase()}`, Number.POSITIVE_INFINITY, async () => {
      const [name, version] = await client.multicall({
        allowFailure: false,
        contracts: [
          { address: token, abi: permitAbi, functionName: "name" },
          { address: token, abi: permitAbi, functionName: "version" },
        ],
      });
      return { name, version };
    });

  /** What a user has in place for the router. Not cached: it changes with the user's own transactions. */
  async function userState(user: Address, token: Address): Promise<UserState> {
    const [balance, allowance, permitNonce, authorized, morphoNonce] = await client.multicall({
      allowFailure: false,
      contracts: [
        { address: token, abi: erc20Abi, functionName: "balanceOf", args: [user] },
        { address: token, abi: erc20Abi, functionName: "allowance", args: [user, deployment.router] },
        { address: token, abi: permitAbi, functionName: "nonces", args: [user] },
        { address: external.morpho, abi: morphoAbi, functionName: "isAuthorized", args: [user, deployment.router] },
        { address: external.morpho, abi: morphoAbi, functionName: "nonce", args: [user] },
      ],
    });
    return { balance, allowance, permitNonce, authorized, morphoNonce };
  }

  return { deployment, markets, session, positions, latestBlock, routerFees, permitDomain, userState, client };
}
