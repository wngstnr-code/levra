import { baseTokens, tokens, xlayerTokens, type Address } from "./addresses";
import { isChainId, type ChainId } from "./chains";
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

/** Monad stock symbols. */
export function isStockSymbol(value: string): value is StockSymbol {
  return Object.hasOwn(stocks, value);
}

export type BaseStockSymbol = "AAPL" | "AMZN" | "GOOGL" | "META" | "MSFT" | "NVDA" | "SPCX" | "TSLA";

/** A stock priced by a Chainlink feed with 8 decimals, as the Coinbase stocks on Base and the xStocks on X Layer. */
export type ChainlinkStock<Symbol extends string = BaseStockSymbol | XLayerStockSymbol, TokenSymbol extends string = string> = {
  symbol: Symbol;
  /** Name of the underlying, taken from the token's on-chain name. */
  name: string;
  tokenSymbol: TokenSymbol;
  token: Address;
  decimals: number;
  priceFeed: Address;
};

export type BaseStock = ChainlinkStock<BaseStockSymbol, `${BaseStockSymbol}c`>;

function coinbaseStock(symbol: BaseStockSymbol, name: string, priceFeed: Address): BaseStock {
  const tokenSymbol = `${symbol}c` as const;
  const token = baseTokens[tokenSymbol];
  return { symbol, name, tokenSymbol, token: token.address, decimals: token.decimals, priceFeed };
}

/** Coinbase stocks on Base with a listed Morpho long market and a Chainlink feed (05, Base). */
export const baseStocks = {
  AAPL: coinbaseStock("AAPL", "Apple Inc.", "0x787f13dEa48Db0897CbCDD985de77809D837F988"),
  AMZN: coinbaseStock("AMZN", "Amazon.com Inc.", "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295"),
  GOOGL: coinbaseStock("GOOGL", "Alphabet Inc.", "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2"),
  META: coinbaseStock("META", "Meta Platforms Inc.", "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D"),
  MSFT: coinbaseStock("MSFT", "Microsoft Corporation", "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c"),
  NVDA: coinbaseStock("NVDA", "NVIDIA Corporation", "0x04689a41629776563E6822F76f2e57D148d28513"),
  SPCX: coinbaseStock("SPCX", "Space Exploration Technologies Corp.", "0x6A634B235903C4ad6376892180d6fF8612e3Fa68"),
  TSLA: coinbaseStock("TSLA", "Tesla Inc.", "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4"),
} as const satisfies Record<BaseStockSymbol, BaseStock>;

export type XLayerStockSymbol = "NVDA" | "QQQ" | "SPY" | "GOOGL";
export type XLayerStock = ChainlinkStock<XLayerStockSymbol, `w${XLayerStockSymbol}x`>;

function xStock(symbol: XLayerStockSymbol, name: string, priceFeed: Address): XLayerStock {
  const tokenSymbol = `w${symbol}x` as const;
  const token = xlayerTokens[tokenSymbol];
  return { symbol, name, tokenSymbol, token: token.address, decimals: token.decimals, priceFeed };
}

/** Wrapped xStocks on X Layer with a listed Morpho long market (D-68). The feeds price one wrapped token (05, X Layer). */
export const xlayerStocks = {
  NVDA: xStock("NVDA", "Wrapped NVIDIA xStock", "0x761FE3B4C1043862bB0c53F5fAAe19F159F6b303"),
  QQQ: xStock("QQQ", "Wrapped Nasdaq xStock", "0x70149e006a03dF3739B8C37E4d80145Dea4c09F6"),
  SPY: xStock("SPY", "Wrapped SP500 xStock", "0xFf1Ad069D1500970e5f0e5375b011C24EA819950"),
  GOOGL: xStock("GOOGL", "Wrapped Alphabet xStock", "0x64B67C4C176E78064E0470a062C83c17AE0FA779"),
} as const satisfies Record<XLayerStockSymbol, XLayerStock>;

export const stocksByChain = { 143: stocks, 8453: baseStocks, 196: xlayerStocks } as const satisfies Record<
  ChainId,
  Record<string, Stock | ChainlinkStock>
>;

export type AnyStock = Stock | ChainlinkStock;

export function findStock(chainId: ChainId, symbol: string): AnyStock | undefined {
  const list: Record<string, AnyStock> = stocksByChain[chainId];
  return Object.hasOwn(list, symbol) ? list[symbol] : undefined;
}

export type MarketInfo = DeployedMarket & { stock: AnyStock };

/** Deployed markets joined with their stock on the deployment's chain. An unknown chain or stock is an error. */
export function listMarkets(deployment: Deployment): MarketInfo[] {
  const chainId = deployment.chainId;
  if (!isChainId(chainId)) throw new Error(`Unknown chain in deployment: ${chainId}`);
  return deployment.markets.map((market) => {
    const stock = findStock(chainId, market.symbol);
    if (!stock) throw new Error(`Unknown stock in deployment: ${market.symbol}`);
    return { ...market, stock };
  });
}

export function findMarket(deployment: Deployment, symbol: string, side: DeployedMarket["side"]): MarketInfo {
  const market = listMarkets(deployment).find((m) => m.symbol === symbol && m.side === side);
  if (!market) throw new Error(`No ${side} market for ${symbol} in this deployment`);
  return market;
}
