import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeEventLog, isAddress, keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { erc20PermitAbi, liquidatorAbi, marginRouterAbi, metaMorphoAbi, morphoAbi, riskManagerAbi, tapeoutCircuitsAbi } from "./abis";
import { BASE_CHAIN_ID, XLAYER_CHAIN_ID, external, externalByChain, teamSafe, tokens, tokensByChain, xlayerTapeout } from "./addresses";
import { parseDeployment, type Deployment } from "./deployments";
import { baseDeployment } from "./deployments.base";
import { monadDeployment } from "./deployments.monad";
import { readDeployment } from "./deployments.node";
import { xlayerDeployment } from "./deployments.xlayer";
import { baseStocks, findMarket, isStockSymbol, listMarkets, stocks, stocksByChain } from "./markets";

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

describe("abis", () => {
  const functions = (abi: readonly { type: string; name?: string }[]) => abi.filter((item) => item.type === "function").map((item) => item.name);

  it("carry the role and ownership reads that the interfaces leave out", () => {
    expect(functions(marginRouterAbi)).toEqual(expect.arrayContaining(["isKeeper", "feeRecipient", "owner", "pendingOwner"]));
    expect(functions(riskManagerAbi)).toEqual(expect.arrayContaining(["calendarPoster", "oracleAgePoster", "guardian", "owner", "pendingOwner"]));
    expect(functions(liquidatorAbi)).toEqual(expect.arrayContaining(["isKeeper", "owner", "pendingOwner"]));
  });

  it("carry the vault reads and the permit nonce", () => {
    expect(functions(metaMorphoAbi)).toEqual(
      expect.arrayContaining(["totalAssets", "fee", "withdrawQueue", "withdrawQueueLength", "convertToAssets", "maxWithdraw"]),
    );
    expect(functions(erc20PermitAbi)).toContain("nonces");
  });

  it("carry the TapeOut circuit reads, and only reads", () => {
    expect(functions(tapeoutCircuitsAbi).sort()).toEqual(["circuitInfo", "eval", "netlist", "ownerOf"]);
    for (const item of tapeoutCircuitsAbi) if (item.type === "function") expect(item.stateMutability).toBe("view");
  });
});

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

  it("put Circle's CCTP V2 at the same addresses on every chain", () => {
    const cctp = Object.values(externalByChain).map((e) => [e.cctpTokenMessengerV2, e.cctpMessageTransmitterV2, e.cctpTokenMinterV2]);
    for (const set of cctp) expect(set).toEqual(cctp[0]);
    expect(new Set(cctp[0]).size).toBe(3);
  });

  it("keep the team Safe checksummed and apart from every other address", () => {
    expect(isAddress(teamSafe, { strict: true })).toBe(true);
    const others = [
      ...Object.values(externalByChain).flatMap((e) => Object.values(e)),
      ...Object.values(tokensByChain).flatMap((t) => Object.values(t).map((token) => token.address)),
      xlayerTapeout.processor,
      xlayerTapeout.transistors,
      xlayerTapeout.operator,
      xlayerTapeout.clockContainer,
    ].map((a) => a.toLowerCase());
    expect(others).not.toContain(teamSafe.toLowerCase());
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
    expect(monadDeployment.router).toBe("0xf5585feA7aeDC5e148201052f73139111810aA88");
    expect(monadDeployment.previousRouters).toEqual(["0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6"]);
    expect(monadDeployment.usdcVault).toBe("0xfB99A7E3f5571baA363d67F7823bb354cfd95447");
  });

  it("bundles the Base mainnet deployment with a long and a short market for every Base stock", () => {
    const markets = listMarkets(baseDeployment);
    expect(baseDeployment.chainId).toBe(BASE_CHAIN_ID);
    expect(baseDeployment.router).toBe("0xf5585feA7aeDC5e148201052f73139111810aA88");
    expect(baseDeployment.usdcVault).toBe("0x58e732287C17922E9f071d09bC0D5bf5Dd7285b8");
    const symbols = Object.keys(baseStocks).sort();
    for (const side of ["long", "short"] as const) {
      expect(markets.filter((m) => m.side === side).map((m) => m.symbol).sort()).toEqual(symbols);
    }
    for (const market of markets) {
      const stockSide = market.side === "long" ? market.collateralToken : market.loanToken;
      const quoteSide = market.side === "long" ? market.loanToken : market.collateralToken;
      expect(stockSide).toBe(market.stock.token);
      expect(quoteSide).toBe(tokensByChain[BASE_CHAIN_ID].USDC.address);
    }
  });
  it("bundles the X Layer mainnet deployment with a long and a short market for every X Layer stock", () => {
    const markets = listMarkets(xlayerDeployment);
    expect(xlayerDeployment.chainId).toBe(XLAYER_CHAIN_ID);
    expect(xlayerDeployment.router).toBe("0xf5585feA7aeDC5e148201052f73139111810aA88");
    const symbols = Object.keys(stocksByChain[XLAYER_CHAIN_ID]).sort();
    for (const side of ["long", "short"] as const) {
      expect(markets.filter((m) => m.side === side).map((m) => m.symbol).sort()).toEqual(symbols);
    }
    for (const market of markets) {
      const stockSide = market.side === "long" ? market.collateralToken : market.loanToken;
      const quoteSide = market.side === "long" ? market.loanToken : market.collateralToken;
      expect(stockSide).toBe(market.stock.token);
      expect(quoteSide).toBe(tokensByChain[XLAYER_CHAIN_ID].USDC.address);
    }
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
