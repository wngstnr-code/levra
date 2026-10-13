import { tokens, type Address } from "./addresses";
import type { DeployedMarket, Deployment } from "./deployments";

export type StockSymbol = "QQQ" | "HOOD" | "BIL";

export type Stock = {
  symbol: StockSymbol;
  /** Name of the underlying, taken from the token's on-chain name. */
  name: string;
  tokenSymbol: string;
  token: Address;
  decimals: number;
  /** keccak256 of the uppercase symbol, the key in the Anchored stock oracle. */
  priceId: `0x${string}`;
};

export const stocks = {
  QQQ: {
    symbol: "QQQ",
    name: "Invesco QQQ",
    tokenSymbol: "aQQQ",
    token: tokens.aQQQ.address,
    decimals: tokens.aQQQ.decimals,
    priceId: "0x3192e549b876a689e8727f4a2e0d4fa13b8456aa0a01f6008ad18fd992e3b532",
  },
  HOOD: {
    symbol: "HOOD",
    name: "Robinhood",
    tokenSymbol: "aHOOD",
    token: tokens.aHOOD.address,
    decimals: tokens.aHOOD.decimals,
    priceId: "0xc72abec7fca8547f25e527c4454eab0d797478d853b33356c73f6bfa685a411c",
  },
  BIL: {
    symbol: "BIL",
    name: "SPDR Bloomberg 1-3M T-Bill",
    tokenSymbol: "aBIL",
    token: tokens.aBIL.address,
    decimals: tokens.aBIL.decimals,
    priceId: "0x8c744a35dcf16af5b20ee9fba365846ae8d495bc0039006d17cd75b70651ea25",
  },
} as const satisfies Record<StockSymbol, Stock>;

export function isStockSymbol(value: string): value is StockSymbol {
  return Object.hasOwn(stocks, value);
}

export type MarketInfo = DeployedMarket & { stock: Stock };

/** Deployed markets joined with their stock. A market for a stock we do not list is an error. */
export function listMarkets(deployment: Deployment): MarketInfo[] {
  return deployment.markets.map((market) => {
    if (!isStockSymbol(market.symbol)) throw new Error(`Unknown stock in deployment: ${market.symbol}`);
    return { ...market, stock: stocks[market.symbol] };
  });
}

export function findMarket(deployment: Deployment, symbol: StockSymbol, side: DeployedMarket["side"]): MarketInfo {
  const market = listMarkets(deployment).find((m) => m.symbol === symbol && m.side === side);
  if (!market) throw new Error(`No ${side} market for ${symbol} in this deployment`);
  return market;
}
