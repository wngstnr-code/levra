"use client";

import { sessionOracleAbi } from "@levra/shared/abis";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import type { WebChain } from "./chains";
import type { OracleSnapshot } from "./marketRows";
import { sessionFromIndex } from "./session";
import { useChain } from "./useChain";

/** One session oracle per stock: the long market's when it exists, otherwise the short one's. */
export function oraclesBySymbol(chain: WebChain): { symbol: string; oracle: Address }[] {
  const seen = new Map<string, Address>();
  for (const mk of [...chain.deployment.markets].sort((a, b) => (a.side === b.side ? 0 : a.side === "long" ? -1 : 1))) {
    if (!seen.has(mk.symbol)) seen.set(mk.symbol, mk.oracle);
  }
  return [...seen.entries()].map(([symbol, oracle]) => ({ symbol, oracle }));
}

/** Price, quote time and session of every listed stock, read from our session oracles (ISessionOracle.snapshot). */
export function useOracleSnapshots() {
  const chain = useChain();
  const list = oraclesBySymbol(chain);
  const query = useReadContracts({
    contracts: list.map((o) => ({ address: o.oracle, abi: sessionOracleAbi, functionName: "snapshot" as const, chainId: chain.id })),
    query: { refetchInterval: 15_000 },
  });
  const snapshots: Partial<Record<string, OracleSnapshot>> = {};
  query.data?.forEach((r, i) => {
    if (r.status !== "success") return;
    const [priceE8, , , session, feedUpdatedAt] = r.result;
    snapshots[list[i]!.symbol] = { priceE8, feedUpdatedAt: Number(feedUpdatedAt), session: sessionFromIndex(session) };
  });
  return { snapshots, isPending: query.isPending, isError: query.isError, refetch: query.refetch, isFetching: query.isFetching };
}
