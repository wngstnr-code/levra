"use client";

import { marginRouterAbi, morphoAbi } from "@levra/shared/abis";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { useChain } from "./useChain";

/** What a user carries over from routers this chain used before (SC-87): access to remove and protection to turn on again. */
export function useRouterUpgrade(user: Address | undefined) {
  const chain = useChain();
  const { router, markets, previousRouters = [] } = chain.deployment;
  const old = previousRouters.filter((r) => r.toLowerCase() !== router.toLowerCase());
  const access = old.map((r) => ({ address: chain.morpho, abi: morphoAbi, functionName: "isAuthorized" as const, args: [user!, r] as const, chainId: chain.id }));
  const protection = [router, ...old].flatMap((r) =>
    markets.map((mk) => ({ address: r, abi: marginRouterAbi, functionName: "protectionEnabled" as const, args: [user!, mk.marketId] as const, chainId: chain.id })),
  );
  const query = useReadContracts({ contracts: [...access, ...protection], query: { enabled: !!user && old.length > 0 } });
  const flags = (query.data ?? []).map((r) => (r.status === "success" ? r.result === true : undefined));
  return { ...upgradeState(old, markets, flags), queryKey: query.queryKey };
}

/**
 * flags: isAuthorized for each old router, then protectionEnabled per market for the current router
 * followed by each old router. A failed read is undefined: never reported as access, and protection is
 * only asked again where the current router answered false.
 */
export function upgradeState<M>(old: Address[], markets: M[], flags: (boolean | undefined)[]) {
  const on = (i: number) => flags[i] === true;
  const base = old.length;
  return {
    oldAccess: old.filter((_, i) => on(i)),
    protectionToRestore: markets.filter((_, j) => flags[base + j] === false && old.some((__, k) => on(base + (k + 1) * markets.length + j))),
  };
}
