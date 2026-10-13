"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { orderDepositTokens } from "../depositTokens";
import { api, apiBaseUrl, ApiRequestError } from "./client";

export const queryKeys = {
  markets: ["markets"] as const,
  marketDetail: (symbol: string) => ["marketDetail", symbol] as const,
  account: (address: string) => ["account", address.toLowerCase()] as const,
  history: (address: string) => ["history", address.toLowerCase()] as const,
  status: ["status"] as const,
  session: ["session"] as const,
  earn: ["earn"] as const,
  earnAccount: (address: string) => ["earnAccount", address.toLowerCase()] as const,
  depositTokens: ["depositTokens"] as const,
  depositStatus: (id: string) => ["depositStatus", id] as const,
  eligibility: (address: string | undefined) => ["eligibility", address?.toLowerCase() ?? null] as const,
};

export const apiConfigured = apiBaseUrl !== null;

/** Retries network trouble, but not answers the service gave on purpose. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status !== undefined && error.status < 500) return false;
  return failureCount < 2;
}

export function useMarkets() {
  return useQuery({
    queryKey: queryKeys.markets,
    queryFn: ({ signal }) => api("markets", { signal }),
    enabled: apiConfigured,
    refetchInterval: 60_000,
    retry: shouldRetry,
  });
}

export function useMarketDetail(symbol: string) {
  return useQuery({
    queryKey: queryKeys.marketDetail(symbol),
    queryFn: ({ signal }) => api("marketDetail", { params: { symbol }, signal }),
    enabled: apiConfigured,
    refetchInterval: 60_000,
    retry: shouldRetry,
  });
}

export function useApiSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: ({ signal }) => api("session", { signal }),
    enabled: apiConfigured,
    refetchInterval: 60_000,
    retry: shouldRetry,
  });
}

export function useAccountData(address: Address | undefined) {
  return useQuery({
    queryKey: queryKeys.account(address ?? "none"),
    queryFn: ({ signal }) => api("account", { params: { address: address! }, signal }),
    enabled: apiConfigured && !!address,
    refetchInterval: 15_000,
    retry: shouldRetry,
  });
}

export function useHistory(address: Address | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.history(address ?? "none"),
    queryFn: ({ pageParam, signal }) =>
      api("accountHistory", { params: { address: address! }, query: { limit: 20, cursor: pageParam ?? undefined }, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: apiConfigured && !!address,
    retry: shouldRetry,
  });
}

export function useServiceStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: ({ signal }) => api("status", { signal }),
    enabled: apiConfigured,
    refetchInterval: 30_000,
    retry: shouldRetry,
  });
}

export function useEarnOptions() {
  return useQuery({ queryKey: queryKeys.earn, queryFn: ({ signal }) => api("earn", { signal }), enabled: apiConfigured, refetchInterval: 60_000, retry: shouldRetry });
}

export function useEarnAccount(address: Address | undefined) {
  return useQuery({
    queryKey: queryKeys.earnAccount(address ?? "none"),
    queryFn: ({ signal }) => api("earnAccount", { params: { address: address! }, signal }),
    enabled: apiConfigured && !!address,
    refetchInterval: 30_000,
    retry: shouldRetry,
  });
}

export function useDepositTokens() {
  return useQuery({
    queryKey: queryKeys.depositTokens,
    queryFn: ({ signal }) => api("depositTokens", { signal }),
    select: (d) => ({ ...d, tokens: orderDepositTokens(d.tokens) }),
    enabled: apiConfigured,
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });
}

const TERMINAL = new Set(["SUCCESS", "REFUNDED", "FAILED", "EXPIRED"]);

/** Follows one cross-chain transfer until it ends. */
export function useDepositStatus(id: string | null) {
  return useQuery({
    queryKey: queryKeys.depositStatus(id ?? "none"),
    queryFn: ({ signal }) => api("depositStatus", { params: { id: id! }, signal }),
    enabled: apiConfigured && !!id,
    refetchInterval: (q) => (q.state.data && TERMINAL.has(q.state.data.status) ? false : 5_000),
    retry: shouldRetry,
  });
}
