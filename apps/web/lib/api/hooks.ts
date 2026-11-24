"use client";

import type { PriceRange } from "@levra/shared/api";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { orderDepositTokens } from "../depositTokens";
import { api, apiBaseUrl, ApiRequestError } from "./client";
import { useChain } from "../useChain";

export const queryKeys = {
  markets: ["markets"] as const,
  stats: ["stats"] as const,
  marketDetail: (symbol: string) => ["marketDetail", symbol] as const,
  prices: (symbol: string, range: PriceRange) => ["prices", symbol, range] as const,
  account: (address: string) => ["account", address.toLowerCase()] as const,
  history: (address: string) => ["history", address.toLowerCase()] as const,
  status: ["status"] as const,
  session: ["session"] as const,
  earn: ["earn"] as const,
  earnAccount: (address: string) => ["earnAccount", address.toLowerCase()] as const,
  depositTokens: ["depositTokens"] as const,
  depositStatus: (id: string) => ["depositStatus", id] as const,
  eligibility: (address: string | undefined, chainId?: number) => ["eligibility", address?.toLowerCase() ?? null, chainId ?? null] as const,
  chains: ["chains"] as const,
};

export const apiConfigured = apiBaseUrl !== null;

/** Retries network trouble, but not answers the service gave on purpose. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status !== undefined && error.status < 500) return false;
  return failureCount < 2;
}

/** Which chains the API serves now (BE-70). Null while unknown or when the API predates the list. */
export function useLiveChains(): Set<number> | null {
  const q = useQuery({
    queryKey: queryKeys.chains,
    queryFn: ({ signal }) => api("chains", { signal }),
    enabled: apiConfigured,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data ? new Set(q.data.chains.filter((c) => c.live).map((c) => c.chainId)) : null;
}

export function useMarkets() {
  const chain = useChain();
  return useQuery({
    queryKey: [...queryKeys.markets, chain.id],
    queryFn: ({ signal }) => api("markets", { chainId: chain.id, signal }),
    enabled: apiConfigured,
    refetchInterval: 60_000,
    retry: shouldRetry,
  });
}

/** Oracle price history for charts (BE-24). The service caches it for 10 s; a minute is enough for a chart. */
export function usePriceHistory(symbol: string, range: PriceRange) {
  const chain = useChain();
  return useQuery({
    queryKey: [...queryKeys.prices(symbol, range), chain.id],
    queryFn: ({ signal }) => api("marketPrices", { chainId: chain.id, params: { symbol }, query: { range }, signal }),
    enabled: apiConfigured,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
    retry: shouldRetry,
  });
}

export function useMarketDetail(symbol: string) {
  const chain = useChain();
  return useQuery({
    queryKey: [...queryKeys.marketDetail(symbol), chain.id],
    queryFn: ({ signal }) => api("marketDetail", { chainId: chain.id, params: { symbol }, signal }),
    enabled: apiConfigured,
    refetchInterval: 60_000,
    retry: shouldRetry,
  });
}

export function useApiSession() {
  const chain = useChain();
  return useQuery({
    queryKey: [...queryKeys.session, chain.id],
    queryFn: ({ signal }) => api("session", { chainId: chain.id, signal }),
    enabled: apiConfigured,
    refetchInterval: 60_000,
    retry: shouldRetry,
  });
}

export function useAccountData(address: Address | undefined) {
  const chain = useChain();
  return useQuery({
    queryKey: [...queryKeys.account(address ?? "none"), chain.id],
    queryFn: ({ signal }) => api("account", { chainId: chain.id, params: { address: address! }, signal }),
    enabled: apiConfigured && !!address,
    refetchInterval: 15_000,
    retry: shouldRetry,
  });
}

export function useHistory(address: Address | undefined) {
  const chain = useChain();
  return useInfiniteQuery({
    queryKey: [...queryKeys.history(address ?? "none"), chain.id],
    queryFn: ({ pageParam, signal }) =>
      api("accountHistory", { chainId: chain.id, params: { address: address! }, query: { limit: 20, cursor: pageParam ?? undefined }, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: apiConfigured && !!address,
    retry: shouldRetry,
  });
}

export function useServiceStatus() {
  const chain = useChain();
  return useQuery({
    queryKey: [...queryKeys.status, chain.id],
    queryFn: ({ signal }) => api("status", { signal }),
    enabled: apiConfigured,
    refetchInterval: 30_000,
    retry: shouldRetry,
  });
}

/** CCTP chains USDC can come from or go to, for the current chain (BE-85). */
export function useBridgeChains() {
  const chain = useChain();
  return useQuery({ queryKey: ["bridgeChains", chain.id], queryFn: ({ signal }) => api("bridgeChains", { chainId: chain.id, signal }), enabled: apiConfigured, staleTime: 10 * 60_000, retry: shouldRetry });
}

/** The share multiplier of a stock on the current chain (Base B20 tokens), or null. */
export function useUiMultiplier(symbol: string | undefined): string | null {
  const markets = useMarkets();
  return markets.data?.markets.find((x) => x.symbol === symbol)?.uiMultiplierWad ?? null;
}

/** Public numbers of the chosen chain (BE-79, D-109). */
export function useStats() {
  const chain = useChain();
  return useQuery({ queryKey: [...queryKeys.stats, chain.id], queryFn: ({ signal }) => api("stats", { chainId: chain.id, signal }), enabled: apiConfigured, refetchInterval: 60_000, retry: shouldRetry });
}

export function useEarnOptions() {
  const chain = useChain();
  return useQuery({ queryKey: [...queryKeys.earn, chain.id], queryFn: ({ signal }) => api("earn", { chainId: chain.id, signal }), enabled: apiConfigured, refetchInterval: 60_000, retry: shouldRetry });
}

export function useEarnAccount(address: Address | undefined) {
  const chain = useChain();
  return useQuery({
    queryKey: [...queryKeys.earnAccount(address ?? "none"), chain.id],
    queryFn: ({ signal }) => api("earnAccount", { chainId: chain.id, params: { address: address! }, signal }),
    enabled: apiConfigured && !!address,
    refetchInterval: 30_000,
    retry: shouldRetry,
  });
}

export function useDepositTokens() {
  const chain = useChain();
  return useQuery({
    queryKey: [...queryKeys.depositTokens, chain.id],
    queryFn: ({ signal }) => api("depositTokens", { chainId: chain.id, signal }),
    select: (d) => ({ ...d, tokens: orderDepositTokens(d.tokens) }),
    enabled: apiConfigured,
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });
}

const TERMINAL = new Set(["SUCCESS", "REFUNDED", "FAILED", "EXPIRED"]);

/** Follows one cross-chain transfer until it ends. */
export function useDepositStatus(id: string | null) {
  const chain = useChain();
  return useQuery({
    queryKey: [...queryKeys.depositStatus(id ?? "none"), chain.id],
    queryFn: ({ signal }) => api("depositStatus", { chainId: chain.id, params: { id: id! }, signal }),
    enabled: apiConfigured && !!id,
    refetchInterval: (q) => (q.state.data && TERMINAL.has(q.state.data.status) ? false : 5_000),
    retry: shouldRetry,
  });
}
