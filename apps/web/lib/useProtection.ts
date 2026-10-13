"use client";

import { marginRouterAbi } from "@levra/shared/abis";
import type { Address, Hex } from "viem";
import { useReadContracts } from "wagmi";
import { monad } from "./chain";
import { deployment } from "./deployment";

/** Whether protection is on, per market, read from the router. */
export function useProtection(user: Address | undefined) {
  const query = useReadContracts({
    contracts: deployment.markets.map((mk) => ({
      address: deployment.router,
      abi: marginRouterAbi,
      functionName: "protectionEnabled" as const,
      args: [user!, mk.marketId] as const,
      chainId: monad.id,
    })),
    query: { enabled: !!user },
  });
  const byMarket = new Map<string, boolean>();
  query.data?.forEach((r, i) => {
    if (r.status === "success") byMarket.set(deployment.markets[i]!.marketId.toLowerCase(), r.result as boolean);
  });
  return { isOn: (marketId: Hex) => byMarket.get(marketId.toLowerCase()), queryKey: query.queryKey, isPending: query.isPending };
}
