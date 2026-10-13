"use client";

import { anchoredStockOracleAbi } from "@levra/shared/abis";
import { external } from "@levra/shared/addresses";
import { stocks } from "@levra/shared/markets";
import { useReadContracts } from "wagmi";
import { monad } from "./chain";
import type { OracleSnapshot } from "./marketRows";
import { sessionFromIndex } from "./session";

const list = Object.values(stocks);

/** Price, quote time and session of every listed stock, read straight from the Anchored oracle. */
export function useOracleSnapshots() {
  const query = useReadContracts({
    contracts: list.map((s) => ({
      address: external.anchoredStockOracle,
      abi: anchoredStockOracleAbi,
      functionName: "latestPrice" as const,
      args: [s.priceId] as const,
      chainId: monad.id,
    })),
    query: { refetchInterval: 15_000 },
  });
  const snapshots: Partial<Record<string, OracleSnapshot>> = {};
  query.data?.forEach((r, i) => {
    if (r.status !== "success") return;
    snapshots[list[i]!.symbol] = { priceE8: BigInt(r.result.price), feedUpdatedAt: Number(r.result.feedUpdateTimestamp), session: sessionFromIndex(r.result.session) };
  });
  return { snapshots, isPending: query.isPending, isError: query.isError, refetch: query.refetch, isFetching: query.isFetching };
}
