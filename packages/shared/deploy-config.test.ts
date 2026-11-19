import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { BASE_CHAIN_ID, externalByChain, MONAD_CHAIN_ID, tokensByChain } from "./addresses";
import { findStock, type ChainlinkStock } from "./markets";

// The deployment configs in contracts/config must use the same addresses as this package, so there is
// one source of truth even though Solidity cannot import TypeScript.
type Market = { symbol: string; stock: string; stockDecimals: number; side: string; feed?: string };
type Config = {
  chainId: number;
  morpho: string;
  irm: string;
  usdc: string;
  usdcDecimals: number;
  swapTargets: string[];
  anchoredOracle: string;
  coinbaseRegistry: string;
  vaultFactory: string;
  markets: Market[];
  vaultCaps: { symbol: string }[];
};

const read = (name: string): Config =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../contracts/config/${name}.json`, import.meta.url)), "utf8"));
const same = (a: string, b: string) => expect(getAddress(a)).toBe(getAddress(b));

describe("contracts/config/monad.json", () => {
  const c = read("monad");
  const ext = externalByChain[MONAD_CHAIN_ID];

  it("uses the shared Monad addresses", () => {
    expect(c.chainId).toBe(MONAD_CHAIN_ID);
    same(c.morpho, ext.morpho);
    same(c.irm, ext.morphoAdaptiveCurveIrm);
    same(c.usdc, tokensByChain[MONAD_CHAIN_ID].USDC.address);
    expect(c.usdcDecimals).toBe(tokensByChain[MONAD_CHAIN_ID].USDC.decimals);
    same(c.anchoredOracle, ext.anchoredStockOracle);
    same(c.vaultFactory, ext.morphoVaultFactory);
    expect(c.swapTargets.map(getAddress)).toEqual([getAddress(ext.kyberRouter)]);
  });

  it("lists only shared Monad stocks with their token and decimals", () => {
    for (const m of c.markets) {
      const stock = findStock(MONAD_CHAIN_ID, m.symbol);
      expect(stock, m.symbol).toBeDefined();
      same(m.stock, stock!.token);
      expect(m.stockDecimals).toBe(stock!.decimals);
    }
  });
});

describe("contracts/config/base.json", () => {
  const c = read("base");
  const ext = externalByChain[BASE_CHAIN_ID];

  it("uses the shared Base addresses and the three swap targets of D-80", () => {
    expect(c.chainId).toBe(BASE_CHAIN_ID);
    same(c.morpho, ext.morpho);
    same(c.irm, ext.morphoAdaptiveCurveIrm);
    same(c.usdc, tokensByChain[BASE_CHAIN_ID].USDC.address);
    same(c.coinbaseRegistry, ext.coinbaseOracleRegistry);
    same(c.vaultFactory, ext.morphoVaultFactory);
    expect(c.swapTargets.map(getAddress)).toEqual([ext.oneInchRouter, ext.kyberRouter, ext.aeroSwapRouter].map(getAddress));
  });

  it("has a long and a short market for every shared Base stock, with its token, decimals and feed", () => {
    for (const side of ["long", "short"]) {
      const symbols = c.markets.filter((m) => m.side === side).map((m) => m.symbol).sort();
      expect(symbols, side).toEqual(["AAPL", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "SPCX", "TSLA"]);
    }
    for (const m of c.markets) {
      const stock = findStock(BASE_CHAIN_ID, m.symbol) as ChainlinkStock | undefined;
      expect(stock, m.symbol).toBeDefined();
      same(m.stock, stock!.token);
      expect(m.stockDecimals).toBe(stock!.decimals);
      same(m.feed!, stock!.priceFeed);
    }
    expect(c.vaultCaps.map((v) => v.symbol).sort()).toEqual(["AAPL", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "SPCX", "TSLA"]);
  });
});
