import { external, tokens } from "@levra/shared/addresses";
import { morphoAbi } from "@levra/shared/abis";
import type { EarnAccount, EarnOption, EarnPosition } from "@levra/shared/api";
import {
  WAD,
  borrowApyWad,
  expectedSupplyShares,
  mulDiv,
  supplyApyWad,
  toAssetsDown,
  utilizationWad,
  vaultSupplyApyWad,
} from "@levra/shared/math";
import { erc20Abi, parseAbi, type Address, type Hex } from "viem";
import { createCache } from "../chain/cache";
import type { ChainReader, MarketState } from "../chain/reader";
import type { StoredEvent } from "../positions/events";

/**
 * MetaMorpho reads used by Earn. Temporary until the ABI export in packages/shared includes MetaMorpho (requested from
 * Wangsit).
 */
const metaMorphoAbi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function fee() view returns (uint96)",
  "function withdrawQueueLength() view returns (uint256)",
  "function withdrawQueue(uint256 index) view returns (bytes32)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
]);

/** Options change with every block, but the screen refreshes slowly. */
const OPTIONS_TTL_MS = 5_000;

export const vaultOptionId = (vault: Address) => `vault:${vault.toLowerCase()}`;
export const marketOptionId = (marketId: Hex) => `market:${marketId.toLowerCase()}`;

/** Lender side of one market: Lens totals with the interest since the last update, plus the share count to match. */
type SupplySide = { state: MarketState; supplyAssets: bigint; supplyShares: bigint; borrowAssets: bigint; supplyApyWad: bigint };

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const liquidity = (s: SupplySide) => (s.supplyAssets > s.borrowAssets ? s.supplyAssets - s.borrowAssets : 0n);

/**
 * Earn (BE-21): the USDC vault, which lends to the long markets, and lending stock directly in the short markets, where
 * stock is the loan token. All numbers come from chain reads; only "earned" needs the indexed deposits.
 */
export function createEarn(reader: ChainReader) {
  const { client, deployment } = reader;
  const cached = createCache();
  const vault = deployment.usdcVault ?? null;
  const stockMarkets = () => reader.markets().then((all) => all.filter((m) => m.info.side === "short"));

  async function supplySides(states: MarketState[]): Promise<Map<string, SupplySide>> {
    const raw = await client.multicall({
      allowFailure: false,
      contracts: states.map((m) => ({ address: external.morpho, abi: morphoAbi, functionName: "market", args: [m.info.marketId] }) as const),
    });
    return new Map(
      states.map((state, i) => {
        const { totalSupplyAssets, totalSupplyShares } = raw[i]!;
        const supplyShares = expectedSupplyShares(totalSupplyAssets, totalSupplyShares, state.totalSupplyRaw, state.morphoFeeWad);
        const utilization = utilizationWad(state.totalBorrowRaw, state.totalSupplyRaw);
        const apy = supplyApyWad(borrowApyWad(state.borrowRatePerSecondWad), utilization, state.morphoFeeWad);
        return [state.info.marketId.toLowerCase(), { state, supplyAssets: state.totalSupplyRaw, supplyShares, borrowAssets: state.totalBorrowRaw, supplyApyWad: apy }];
      }),
    );
  }

  async function vaultOption(address: Address): Promise<EarnOption> {
    const [totalAssets, fee, queueLength, idle] = await client.multicall({
      allowFailure: false,
      contracts: [
        { address, abi: metaMorphoAbi, functionName: "totalAssets" },
        { address, abi: metaMorphoAbi, functionName: "fee" },
        { address, abi: metaMorphoAbi, functionName: "withdrawQueueLength" },
        { address: tokens.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [address] },
      ],
    });
    const queue = await client.multicall({
      allowFailure: false,
      contracts: Array.from({ length: Number(queueLength) }, (_, i) => ({ address, abi: metaMorphoAbi, functionName: "withdrawQueue", args: [BigInt(i)] }) as const),
    });
    const positions = await client.multicall({
      allowFailure: false,
      contracts: queue.map((id) => ({ address: external.morpho, abi: morphoAbi, functionName: "position", args: [id, address] }) as const),
    });
    const markets = await reader.markets();
    const sides = await supplySides(markets.filter((m) => queue.some((id) => id.toLowerCase() === m.info.marketId.toLowerCase())));

    let available = idle;
    let borrowed = 0n;
    const allocations: { assets: bigint; supplyApyWad: bigint }[] = [];
    for (const [i, id] of queue.entries()) {
      const side = sides.get(id.toLowerCase());
      // A market outside our deployment is counted as earning nothing and not withdrawable: the cautious reading.
      if (!side) continue;
      const assets = toAssetsDown(positions[i]!.supplyShares, side.supplyAssets, side.supplyShares);
      allocations.push({ assets, supplyApyWad: side.supplyApyWad });
      available += min(assets, liquidity(side));
      borrowed += mulDiv(assets, utilizationWad(side.borrowAssets, side.supplyAssets), WAD);
    }

    return {
      id: vaultOptionId(address),
      kind: "vault",
      asset: tokens.USDC.address,
      assetSymbol: "USDC",
      target: address,
      marketId: null,
      supplyApyWad: vaultSupplyApyWad(allocations, totalAssets, fee).toString(),
      totalSuppliedRaw: totalAssets.toString(),
      utilizationWad: utilizationWad(borrowed, totalAssets).toString(),
      availableToWithdrawRaw: min(available, totalAssets).toString(),
      feeWad: fee.toString(),
    };
  }

  const marketOption = (s: SupplySide): EarnOption => ({
    id: marketOptionId(s.state.info.marketId),
    kind: "market",
    asset: s.state.info.loanToken,
    assetSymbol: s.state.info.stock.tokenSymbol,
    target: external.morpho,
    marketId: s.state.info.marketId,
    supplyApyWad: s.supplyApyWad.toString(),
    totalSuppliedRaw: s.supplyAssets.toString(),
    utilizationWad: utilizationWad(s.borrowAssets, s.supplyAssets).toString(),
    availableToWithdrawRaw: liquidity(s).toString(),
    feeWad: null,
  });

  const options = () =>
    cached("options", OPTIONS_TTL_MS, async (): Promise<EarnOption[]> => {
      const [vaultOpt, sides] = await Promise.all([vault ? vaultOption(vault) : null, stockMarkets().then(supplySides)]);
      return [...(vaultOpt ? [vaultOpt] : []), ...[...sides.values()].map(marketOption)];
    });

  /** Not cached: it changes with the user's own transactions. */
  async function account(user: Address, events: StoredEvent[]): Promise<EarnAccount> {
    const sides = await stockMarkets().then(supplySides);
    const list = [...sides.values()];
    const [vaultReads, positions] = await Promise.all([
      vault
        ? client.multicall({
            allowFailure: false,
            contracts: [
              { address: vault, abi: erc20Abi, functionName: "balanceOf", args: [user] },
              { address: vault, abi: metaMorphoAbi, functionName: "maxWithdraw", args: [user] },
            ],
          })
        : null,
      client.multicall({
        allowFailure: false,
        contracts: list.map((s) => ({ address: external.morpho, abi: morphoAbi, functionName: "position", args: [s.state.info.marketId, user] }) as const),
      }),
    ]);

    const result: EarnPosition[] = [];
    if (vault && vaultReads && vaultReads[0] > 0n) {
      const supplied = await client.readContract({ address: vault, abi: metaMorphoAbi, functionName: "convertToAssets", args: [vaultReads[0]] });
      const net = netDeposits(events, "vault", vault, "Deposit", "Withdraw");
      result.push({ optionId: vaultOptionId(vault), suppliedRaw: supplied.toString(), earnedRaw: (supplied - net).toString(), withdrawableRaw: vaultReads[1].toString() });
    }
    for (const [i, s] of list.entries()) {
      const shares = positions[i]!.supplyShares;
      if (shares === 0n) continue;
      const supplied = toAssetsDown(shares, s.supplyAssets, s.supplyShares);
      const net = netDeposits(events, "morpho", s.state.info.marketId, "Supply", "Withdraw");
      result.push({
        optionId: marketOptionId(s.state.info.marketId),
        suppliedRaw: supplied.toString(),
        earnedRaw: (supplied - net).toString(),
        withdrawableRaw: min(supplied, liquidity(s)).toString(),
      });
    }
    return { address: user, positions: result };
  }

  return { options, account };
}

/**
 * Assets put in minus assets taken out, from the indexed events of one vault or market. Vault shares received by a
 * plain transfer are not deposits, so for them the whole value shows as earned.
 */
export function netDeposits(events: StoredEvent[], source: "vault" | "morpho", target: string, inName: string, outName: string): bigint {
  let net = 0n;
  for (const e of events) {
    if (e.source !== source || e.marketId.toLowerCase() !== target.toLowerCase()) continue;
    const assets = BigInt(String(e.args.assets ?? "0"));
    if (e.name === inName) net += assets;
    else if (e.name === outName) net -= assets;
  }
  return net;
}
