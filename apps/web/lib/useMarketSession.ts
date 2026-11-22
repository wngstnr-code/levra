"use client";

import { sessionOracleAbi } from "@levra/shared/abis";
import type { SessionName } from "@levra/shared/api";
import { useReadContract } from "wagmi";
import { sessionFromIndex } from "./session";
import { useChain } from "./useChain";
import { oraclesBySymbol } from "./useOracleSnapshots";

/** The US market session. Every listed stock reports the same session, so one oracle read is enough. */
export function useMarketSession(): SessionName | null {
  const chain = useChain();
  const first = oraclesBySymbol(chain)[0];
  const { data } = useReadContract({
    address: first?.oracle,
    abi: sessionOracleAbi,
    functionName: "snapshot",
    chainId: chain.id,
    query: { enabled: !!first, refetchInterval: 30_000 },
  });
  return data ? sessionFromIndex(data[3]) : null;
}
