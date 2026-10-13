import { monadDeployment } from "@levra/shared/deployments/monad";
import { stocks, type StockSymbol } from "@levra/shared/markets";
import type { Hex } from "viem";

export const deployment = monadDeployment;

export function deployedMarket(symbol: string, side: "long" | "short") {
  return deployment.markets.find((m) => m.symbol === symbol && m.side === side) ?? null;
}

export function stockOf(symbol: string) {
  return (stocks as Record<string, (typeof stocks)[StockSymbol]>)[symbol] ?? null;
}

export function marketIdOf(symbol: string, side: "long" | "short"): Hex | null {
  return deployedMarket(symbol, side)?.marketId ?? null;
}
