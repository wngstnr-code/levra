import { isAddress } from "viem";
import { describe, expect, it } from "vitest";
import { BASE_CHAIN_ID, external, externalByChain, MONAD_CHAIN_ID, tokens, tokensByChain } from "./addresses";
import { chainBySlug, chainIds, chains, DEFAULT_CHAIN_ID, isChainId } from "./chains";
import { parseDeployment, type Deployment } from "./deployments";
import { baseStocks, findMarket, findStock, listMarkets, stocks, stocksByChain } from "./markets";

const baseSample: Deployment = {
  chainId: BASE_CHAIN_ID,
  block: 59495063,
  router: "0x5f246ADDCF057E0f778CD422e20e413be70f9a0c",
  riskManager: "0x3C2BafebbB0c8c58f39A976e725cD20D611d01e9",
  lens: "0xaD82Ecf79e232B0391C5479C7f632aA1EA701Ed1",
  markets: [
    {
      symbol: "NVDA",
      side: "short",
      marketId: "0xb4b42dd66cef25614b94510a910d54b2c148e7621d22b4271566724beda63d13",
      oracle: "0x91A1EeE63f300B8f41AE6AF67eDEa2e2ed8c3f79",
      collateralToken: tokensByChain[BASE_CHAIN_ID].USDC.address,
      loanToken: tokensByChain[BASE_CHAIN_ID].NVDAc.address,
      lltv: "625000000000000000",
    },
  ],
};

describe("chains", () => {
  it("list Monad and Base, with Monad as the default", () => {
    expect(chainIds).toEqual([143, 8453]);
    expect(DEFAULT_CHAIN_ID).toBe(MONAD_CHAIN_ID);
    expect(chains[BASE_CHAIN_ID].slug).toBe("base");
  });

  it("are found by ID and slug", () => {
    expect(isChainId(8453)).toBe(true);
    expect(isChainId(1)).toBe(false);
    expect(chainBySlug("monad")?.id).toBe(143);
    expect(chainBySlug("ethereum")).toBeUndefined();
  });
});

describe("addresses per chain", () => {
  for (const chainId of chainIds) {
    const entries = [
      ...Object.entries(externalByChain[chainId]),
      ...Object.entries(tokensByChain[chainId]).map(([k, v]) => [k, v.address] as const),
    ];

    it(`are checksummed and unique on chain ${chainId}`, () => {
      for (const [name, address] of entries) expect(isAddress(address, { strict: true }), name).toBe(true);
      expect(new Set(entries.map(([, a]) => a.toLowerCase())).size).toBe(entries.length);
    });
  }

  it("keep the Monad exports as they were", () => {
    expect(externalByChain[MONAD_CHAIN_ID]).toBe(external);
    expect(tokensByChain[MONAD_CHAIN_ID]).toBe(tokens);
    expect(stocksByChain[MONAD_CHAIN_ID]).toBe(stocks);
  });

  it("give Coinbase stock tokens 8 decimals and USDC 6", () => {
    const { USDC, ...stockTokens } = tokensByChain[BASE_CHAIN_ID];
    expect(USDC.decimals).toBe(6);
    for (const [name, token] of Object.entries(stockTokens)) {
      expect(token.decimals, name).toBe(8);
      expect(token.address.toLowerCase().startsWith("0xb2000"), name).toBe(true);
    }
  });
});

describe("Base stocks", () => {
  it("point at their token and a checksummed feed", () => {
    for (const stock of Object.values(baseStocks)) {
      expect(stock.token).toBe(tokensByChain[BASE_CHAIN_ID][stock.tokenSymbol].address);
      expect(isAddress(stock.priceFeed, { strict: true }), stock.symbol).toBe(true);
    }
  });

  it("are found only on their own chain", () => {
    expect(findStock(BASE_CHAIN_ID, "NVDA")?.tokenSymbol).toBe("NVDAc");
    expect(findStock(MONAD_CHAIN_ID, "NVDA")).toBeUndefined();
    expect(findStock(BASE_CHAIN_ID, "QQQ")).toBeUndefined();
    expect(findStock(BASE_CHAIN_ID, "toString")).toBeUndefined();
  });
});

describe("deployment per chain", () => {
  it("joins Base markets with Base stocks", () => {
    const market = findMarket(parseDeployment(baseSample), "NVDA", "short");
    expect(market.stock.tokenSymbol).toBe("NVDAc");
    expect(market.loanToken).toBe(market.stock.token);
  });

  it("rejects an unknown chain or a stock from another chain", () => {
    expect(() => listMarkets(parseDeployment({ ...baseSample, chainId: 1 }))).toThrow(/Unknown chain/);
    const monadStock = { ...baseSample, markets: [{ ...baseSample.markets[0], symbol: "QQQ" }] };
    expect(() => listMarkets(parseDeployment(monadStock))).toThrow(/Unknown stock/);
  });
});
