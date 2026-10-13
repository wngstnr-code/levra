"use client";

import { anchoredStockOracleAbi } from "@levra/shared/abis";
import { external } from "@levra/shared/addresses";
import type { SessionName } from "@levra/shared/api";
import { stocks } from "@levra/shared/markets";
import { useReadContract } from "wagmi";
import { monad } from "./chain";
import { sessionFromIndex } from "./session";

/** The US market session. Every listed stock reports the same session, so one oracle read is enough. */
export function useMarketSession(): SessionName | null {
  const { data } = useReadContract({
    address: external.anchoredStockOracle,
    abi: anchoredStockOracleAbi,
    functionName: "latestPrice",
    args: [stocks.QQQ.priceId],
    chainId: monad.id,
    query: { refetchInterval: 30_000 },
  });
  return data ? sessionFromIndex(data.session) : null;
}
