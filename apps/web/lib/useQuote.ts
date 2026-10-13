"use client";

import type { SignatureInput } from "@levra/shared/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Address } from "viem";
import { api, type ApiBody, type ApiResponse } from "./api/client";
import { apiConfigured, shouldRetry } from "./api/hooks";

type QuoteName = "quoteOpen" | "quoteClose" | "quoteCollateral";
type Params<N extends QuoteName> = Omit<ApiBody<N>, "user" | "signatures">;

/**
 * A live quote from the service. It refreshes before it expires, so what the user confirms is never stale.
 * `refresh` asks again with new signatures and returns the fresh answer.
 */
export function useQuote<N extends QuoteName>(name: N, user: Address | undefined, params: Params<N> | null, signatures: SignatureInput[] = []) {
  const queryClient = useQueryClient();
  const keyFor = useCallback((sigs: SignatureInput[]) => [name, user, params, sigs.map((s) => s.type)] as const, [name, user, params]);
  const bodyFor = useCallback(
    (sigs: SignatureInput[]) => ({ ...(params as object), user: user!, ...(sigs.length && name !== "quoteClose" ? { signatures: sigs } : {}) }) as ApiBody<N>,
    [name, user, params],
  );

  const query = useQuery({
    queryKey: keyFor(signatures),
    queryFn: ({ signal }) => api(name, { body: bodyFor(signatures), signal }),
    enabled: apiConfigured && !!user && !!params,
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
    retry: shouldRetry,
  });

  const refresh = useCallback(
    async (sigs: SignatureInput[]): Promise<ApiResponse<N>> => queryClient.fetchQuery({ queryKey: keyFor(sigs), queryFn: () => api(name, { body: bodyFor(sigs) }), staleTime: 0 }),
    [queryClient, keyFor, bodyFor, name],
  );

  return { ...query, refresh };
}
