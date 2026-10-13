"use client";

import { termsMessage } from "@levra/shared/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Address } from "viem";
import { useConfig } from "wagmi";
import { signMessage } from "wagmi/actions";
import { api, ApiRequestError } from "./api/client";
import { apiConfigured, queryKeys, shouldRetry } from "./api/hooks";

export type ComplianceStatus = "unchecked" | "loading" | "error" | "blocked" | "needsTerms" | "ok";

/** The service leaves the region and terms routes off until a terms version is set (03, BE-52), and then gates nothing. */
const gateOff = (e: unknown) => e instanceof ApiRequestError && e.code === "NOT_FOUND";

/** Region and terms checks before opening, supplying or depositing (FE-50). Closing and withdrawing are never gated. */
export function useCompliance(address: Address | undefined) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: queryKeys.eligibility(address),
    queryFn: ({ signal }) => api("eligibility", { query: { address }, signal }),
    enabled: apiConfigured,
    staleTime: 5 * 60_000,
    retry: shouldRetry,
  });

  const status: ComplianceStatus = !apiConfigured
    ? "unchecked"
    : q.isPending
      ? "loading"
      : q.isError
        ? gateOff(q.error)
          ? "ok"
          : "error"
        : !q.data.eligible
          ? "blocked"
          : address && q.data.termsAccepted !== true
            ? "needsTerms"
            : "ok";

  const accept = useCallback(async () => {
    if (!address || !q.data) return;
    const signature = await signMessage(config, { account: address, message: termsMessage(q.data.termsVersion, address) });
    await api("termsAccept", { body: { address, termsVersion: q.data.termsVersion, signature } });
    await queryClient.invalidateQueries({ queryKey: queryKeys.eligibility(address) });
  }, [address, config, q.data, queryClient]);

  return { status, termsVersion: q.data?.termsVersion ?? null, error: q.error, retry: q.refetch, accept };
}
