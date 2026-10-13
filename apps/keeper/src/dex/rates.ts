import { marketRates } from "@levra/db";
import { external } from "@levra/shared/addresses";
import { lensAbi, morphoAbi } from "@levra/shared/abis";
import type { Deployment } from "@levra/shared/deployments";
import { borrowApyWad, supplyApyWad, utilizationWad } from "@levra/shared/math";
import type { PublicClient } from "viem";

export type RateRow = typeof marketRates.$inferInsert;

/** One rate snapshot per market from `Lens` and Morpho's market fee, the same numbers `/v1/markets` shows (BE-23). */
export async function readRates(client: PublicClient, deployment: Deployment, at: Date): Promise<RateRow[]> {
  const views = await client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getMarkets" });
  const fees = await client.multicall({
    allowFailure: false,
    contracts: views.map((v) => ({ address: external.morpho, abi: morphoAbi, functionName: "market", args: [v.marketId] }) as const),
  });
  const byId = new Map(deployment.markets.map((m) => [m.marketId.toLowerCase(), m]));
  return views.flatMap((v, i) => {
    const market = byId.get(v.marketId.toLowerCase());
    if (!market) return [];
    const utilization = utilizationWad(v.totalBorrowAssets, v.totalSupplyAssets);
    const borrowApy = borrowApyWad(v.borrowRatePerSecond);
    return [
      {
        marketId: v.marketId.toLowerCase(),
        symbol: market.symbol,
        side: market.side,
        borrowApyWad: borrowApy.toString(),
        supplyApyWad: supplyApyWad(borrowApy, utilization, fees[i]!.fee).toString(),
        utilizationWad: utilization.toString(),
        totalSupplyRaw: v.totalSupplyAssets.toString(),
        totalBorrowRaw: v.totalBorrowAssets.toString(),
        measuredAt: at,
      },
    ];
  });
}
