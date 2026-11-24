"use client";

import type { PreparedResponse } from "@levra/shared/api";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { api } from "./api/client";
import { apiConfigured } from "./api/hooks";
import { sameWallet } from "./prepared";
import { useChain } from "./useChain";
import { useNowSeconds } from "./useNow";

/**
 * The prepared action behind an `?agent=` link, only when the service knows it, it has not expired, it is for the
 * connected wallet and this chain, and `matches` says the screen shows the same request. Otherwise null, so a crafted
 * link never gets the "Prepared by your agent" mark.
 */
export function useAgentRequest(id: string | null, user: Address | undefined, matches: (p: PreparedResponse) => boolean): PreparedResponse | null {
  const chain = useChain();
  const now = useNowSeconds();
  const q = useQuery({ queryKey: ["prepared", id], queryFn: ({ signal }) => api("prepared", { params: { id: id! }, signal }), enabled: apiConfigured && !!id, retry: false, staleTime: 60_000 });
  const p = q.data;
  if (!p || p.expiresAt <= now || p.chainId !== chain.id || !sameWallet(user, p.user) || !matches(p)) return null;
  return p;
}
