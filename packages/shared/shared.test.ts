import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeEventLog, isAddress, keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { morphoAbi } from "./abis";
import { external, tokens } from "./addresses";
import { parseDeployment, type Deployment } from "./deployments";
import { monadDeployment } from "./deployments.monad";
import { readDeployment } from "./deployments.node";
import { findMarket, isStockSymbol, listMarkets, stocks } from "./markets";

const forkFile = fileURLToPath(new URL("../../contracts/deployments/fork.json", import.meta.url));

const sample: Deployment = {
  chainId: 143,
  block: 112980350,
  router: "0x5f246ADDCF057E0f778CD422e20e413be70f9a0c",
  riskManager: "0x3C2BafebbB0c8c58f39A976e725cD20D611d01e9",
  lens: "0xaD82Ecf79e232B0391C5479C7f632aA1EA701Ed1",
  markets: [
    {
      symbol: "QQQ",
      side: "long",
      marketId: "0xb8832f4f1a95df00a7318c2bd96fa0ab908a6d852daba67c8322fa1363460426",
      oracle: "0x91A1EeE63f300B8f41AE6AF67eDEa2e2ed8c3f79",
      collateralToken: tokens.aQQQ.address,
      loanToken: tokens.USDC.address,
      lltv: "770000000000000000",
    },
  ],
};

describe("addresses", () => {
  const all = [...Object.entries(external), ...Object.entries(tokens).map(([k, v]) => [k, v.address] as const)];

  it("are checksummed", () => {
    for (const [name, address] of all) {
      expect(isAddress(address, { strict: true }), name).toBe(true);
    }
  });

  it("are unique", () => {
    const seen = new Set(all.map(([, address]) => address.toLowerCase()));
    expect(seen.size).toBe(all.length);
  });
});

describe("stocks", () => {
  it("have a price ID that is the hash of the symbol", () => {
    for (const stock of Object.values(stocks)) {
      expect(stock.priceId).toBe(keccak256(toBytes(stock.symbol)));
    }
  });

  it("point at the listed token", () => {
    expect(stocks.QQQ.token).toBe(tokens.aQQQ.address);
    expect(isStockSymbol("QQQ")).toBe(true);
    expect(isStockSymbol("NVDA")).toBe(false);
    expect(isStockSymbol("toString")).toBe(false);
  });
});

describe("deployment", () => {
  it("joins markets with their stock", () => {
    const market = findMarket(parseDeployment(sample), "QQQ", "long");
    expect(market.stock.tokenSymbol).toBe("aQQQ");
    expect(market.collateralToken).toBe(market.stock.token);
    expect(() => findMarket(sample, "QQQ", "short")).toThrow();
  });

  it("rejects a file with a missing address or an unknown stock", () => {
    expect(() => parseDeployment({ ...sample, router: undefined })).toThrow();
    const unknown = { ...sample, markets: [{ ...sample.markets[0], symbol: "NVDA" }] };
    expect(() => listMarkets(parseDeployment(unknown))).toThrow();
  });

  it.skipIf(!existsSync(forkFile))("accepts the file the deployment script wrote for the local fork", () => {
    expectAllMarketsInScope(readDeployment(forkFile));
  });

  it("bundles the Monad mainnet deployment", () => {
    expectAllMarketsInScope(monadDeployment);
    expect(monadDeployment.router).toBe("0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6");
  });
});

function expectAllMarketsInScope(deployment: Deployment) {
  const markets = listMarkets(deployment);
  expect(deployment.chainId).toBe(143);
  expect(markets.map((m) => `${m.symbol} ${m.side}`)).toEqual([
    "QQQ long",
    "HOOD long",
    "BIL long",
    "QQQ short",
    "HOOD short",
  ]);
  for (const market of markets) {
    const stockSide = market.side === "long" ? market.collateralToken : market.loanToken;
    const quoteSide = market.side === "long" ? market.loanToken : market.collateralToken;
    expect(stockSide).toBe(market.stock.token);
    expect(quoteSide).toBe(tokens.USDC.address);
  }
}
