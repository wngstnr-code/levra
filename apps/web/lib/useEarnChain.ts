"use client";

import { morphoAbi } from "@levra/shared/abis";
import { external, tokens } from "@levra/shared/addresses";
import { toAssetsDown } from "@levra/shared/math";
import { erc20Abi, erc4626Abi, zeroAddress, type Address, type Hex } from "viem";
import { useReadContracts } from "wagmi";
import { monad } from "./chain";
import { deployment, stockOf } from "./deployment";

export type MarketParams = { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint };

export type EarnChainOption = {
  id: string;
  kind: "vault" | "market";
  symbol: string;
  token: Address;
  decimals: number;
  target: Address;
  marketId: Hex | null;
  marketParams: MarketParams | null;
  totalSuppliedRaw: bigint;
  totalBorrowedRaw: bigint | null;
  user: { suppliedRaw: bigint; withdrawableRaw: bigint; shares: bigint; walletRaw: bigint; allowanceRaw: bigint } | null;
};

/** Stock lending happens in the short markets, where the stock is the loan token. */
const lendingMarkets = deployment.markets.filter((m) => m.side === "short");
const vault = deployment.usdcVault ?? null;

/**
 * Totals and the user's own deposits, read straight from the vault and Morpho.
 * This keeps lending and withdrawing possible even when the Levra service is offline (D-07).
 */
export function useEarnChain(user: Address | undefined) {
  const who = user ?? zeroAddress;
  const vaultCalls = vault
    ? ([
        { address: vault, abi: erc4626Abi, functionName: "totalAssets" },
        { address: vault, abi: erc4626Abi, functionName: "balanceOf", args: [who] },
        { address: vault, abi: erc4626Abi, functionName: "maxWithdraw", args: [who] },
        { address: tokens.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [who] },
        { address: tokens.USDC.address, abi: erc20Abi, functionName: "allowance", args: [who, vault] },
        { address: vault, abi: erc4626Abi, functionName: "totalSupply" },
      ] as const)
    : [];
  const marketCalls = lendingMarkets.flatMap((mk) => [
    { address: external.morpho, abi: morphoAbi, functionName: "market", args: [mk.marketId] } as const,
    { address: external.morpho, abi: morphoAbi, functionName: "position", args: [mk.marketId, who] } as const,
    { address: external.morpho, abi: morphoAbi, functionName: "idToMarketParams", args: [mk.marketId] } as const,
    { address: mk.loanToken, abi: erc20Abi, functionName: "balanceOf", args: [who] } as const,
    { address: mk.loanToken, abi: erc20Abi, functionName: "allowance", args: [who, external.morpho] } as const,
  ]);

  const query = useReadContracts({
    contracts: [...vaultCalls, ...marketCalls].map((c) => ({ ...c, chainId: monad.id })),
    query: { refetchInterval: 20_000 },
  });

  const r = query.data;
  const ok = <T,>(i: number): T | null => (r?.[i]?.status === "success" ? (r[i]!.result as T) : null);
  const options: EarnChainOption[] = [];

  if (vault && r) {
    const shares = ok<bigint>(1) ?? 0n;
    const totalAssets = ok<bigint>(0) ?? 0n;
    const totalShares = ok<bigint>(5) ?? 0n;
    const assets = totalShares > 0n ? (shares * totalAssets) / totalShares : 0n;
    options.push({
      id: "vault",
      kind: "vault",
      symbol: "USDC",
      token: tokens.USDC.address,
      decimals: tokens.USDC.decimals,
      target: vault,
      marketId: null,
      marketParams: null,
      totalSuppliedRaw: totalAssets,
      totalBorrowedRaw: null,
      user: user ? { suppliedRaw: assets, withdrawableRaw: ok<bigint>(2) ?? 0n, shares, walletRaw: ok<bigint>(3) ?? 0n, allowanceRaw: ok<bigint>(4) ?? 0n } : null,
    });
  }

  const offset = vaultCalls.length;
  lendingMarkets.forEach((mk, i) => {
    if (!r) return;
    const base = offset + i * 5;
    const market = ok<{ totalSupplyAssets: bigint; totalSupplyShares: bigint; totalBorrowAssets: bigint }>(base);
    const position = ok<{ supplyShares: bigint }>(base + 1);
    const params = ok<MarketParams>(base + 2);
    const stock = stockOf(mk.symbol);
    if (!market || !stock) return;
    const supplied = position && market.totalSupplyShares > 0n ? toAssetsDown(position.supplyShares, market.totalSupplyAssets, market.totalSupplyShares) : 0n;
    const liquidity = market.totalSupplyAssets - market.totalBorrowAssets;
    options.push({
      id: mk.marketId,
      kind: "market",
      symbol: stock.tokenSymbol,
      token: mk.loanToken,
      decimals: stock.decimals,
      target: external.morpho,
      marketId: mk.marketId,
      marketParams: params,
      totalSuppliedRaw: market.totalSupplyAssets,
      totalBorrowedRaw: market.totalBorrowAssets,
      user: user
        ? { suppliedRaw: supplied, withdrawableRaw: supplied < liquidity ? supplied : liquidity, shares: position?.supplyShares ?? 0n, walletRaw: ok<bigint>(base + 3) ?? 0n, allowanceRaw: ok<bigint>(base + 4) ?? 0n }
        : null,
    });
  });

  return { options, isPending: query.isPending, isError: query.isError, refetch: query.refetch, queryKey: query.queryKey };
}
