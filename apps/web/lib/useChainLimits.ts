"use client";

import { riskManagerAbi } from "@levra/shared/abis";
import { maxLeverageE2 } from "@levra/shared/math";
import { useReadContracts } from "wagmi";
import { deployedMarketOn } from "./chains";
import { useChain } from "./useChain";

/**
 * The current soft limit and position cap of one market, read from RiskManager. The trade form uses
 * them when the service has not answered yet, so leverage can be chosen without the service.
 */
export function useChainLimits(symbol: string, side: "long" | "short") {
  const chain = useChain();
  const id = deployedMarketOn(chain, symbol, side)?.marketId ?? null;
  const q = useReadContracts({
    contracts: id
      ? [
          { address: chain.deployment.riskManager, abi: riskManagerAbi, functionName: "currentSoftLtv", args: [id], chainId: chain.id },
          { address: chain.deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [id], chainId: chain.id },
        ]
      : [],
    query: { enabled: !!id, refetchInterval: 60_000 },
  });
  const soft = q.data?.[0]?.status === "success" ? (q.data[0].result as bigint) : null;
  const config = q.data?.[1]?.status === "success" ? (q.data[1].result as { maxPositionUsd: bigint }) : null;
  return {
    softLtvWad: soft,
    maxLeverageE2: soft !== null && soft > 0n ? maxLeverageE2(side, soft) : null,
    maxPositionUsdRaw: config ? config.maxPositionUsd : null,
  };
}
