import { tokens } from "@levra/shared/addresses";
import { lensAbi, riskManagerAbi, sessionOracleAbi } from "@levra/shared/abis";
import { marketsResponse, sessionInfo } from "@levra/shared/api";
import { cautiousPriceE8, liquidationPriceE8, maxLeverageE2, morphoOraclePrice, positionLtvWad } from "@levra/shared/math";
import pino from "pino";
import { parseUnits, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createChainClient } from "../src/chain/client";
import { createChainReader } from "../src/chain/reader";
import { as, createForkClient, forkDeployment, forkRpcUrl, onFork, openOnMorpho, randomAddress, send } from "./fork-helpers";

describe.skipIf(!onFork)("on the local fork (needs FORK_RPC_URL and FORK_DEPLOYMENT_FILE)", () => {
  const deployment = forkDeployment();
  const reader = createChainReader(createChainClient(forkRpcUrl), deployment);
  const app = createApp({ logger: pino({ level: "silent" }), reader });
  const chain = createForkClient(forkRpcUrl);

  let snapshotId: Hex;
  beforeAll(async () => {
    snapshotId = await chain.snapshot();
  });
  afterAll(async () => {
    await chain.revert({ id: snapshotId });
  });

  it("serves markets whose numbers match direct reads from the contracts", { timeout: 30_000 }, async () => {
    const body = marketsResponse.parse(await (await app.request("/v1/markets")).json());
    expect(body.markets).toHaveLength(deployment.markets.length);

    for (const m of body.markets) {
      const deployed = deployment.markets.find((d) => d.marketId === m.marketId);
      if (!deployed) throw new Error(`unexpected market ${m.marketId}`);
      const [snapshot, config, currentSoft] = await Promise.all([
        chain.readContract({ address: deployed.oracle, abi: sessionOracleAbi, functionName: "snapshot" }),
        chain.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [m.marketId] }),
        chain.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "currentSoftLtv", args: [m.marketId] }),
      ]);
      expect(m.oraclePriceE8).toBe(snapshot[0].toString());
      expect(m.oracleFeedUpdatedAt).toBe(Number(snapshot[4]));
      expect(m.oraclePublishedAt).toBe(Number(snapshot[5]));
      expect(m.softLtvOpenWad).toBe(config.softLtvOpen.toString());
      expect(m.softLtvClosedWad).toBe(config.softLtvClosed.toString());
      expect(m.currentSoftLtvWad).toBe(currentSoft.toString());
      expect(m.maxPositionUsdRaw).toBe(config.maxPositionUsd.toString());
      expect(m.lltvWad).toBe(deployed.lltv);
      expect(m.maxLeverageE2).toBe(maxLeverageE2(m.side, currentSoft));
    }
  });

  it("follows maxOracleAge from the chain without a restart", { timeout: 60_000 }, async () => {
    const market = deployment.markets[0]!;
    const owner = await chain.readContract({
      address: deployment.riskManager,
      abi: [{ type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }],
      functionName: "owner",
    });
    const config = await chain.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [market.marketId] });
    const staleOf = async () => {
      await new Promise((r) => setTimeout(r, 2_100));
      const body = marketsResponse.parse(await (await app.request("/v1/markets")).json());
      return body.markets.find((m) => m.marketId === market.marketId)!;
    };

    // Two values far apart, so the result does not depend on how old the fork is: one day never trips the open check,
    // one second always does. Only the hard check in SessionOracle could still mark it stale on a fork older than its limit.
    const setAge = (maxOracleAge: number) =>
      as(chain, owner, () => send(chain, owner, deployment.riskManager, riskManagerAbi, "setMarketConfig", [market.marketId, { ...config, maxOracleAge }]));
    try {
      await setAge(86_400);
      if ((await staleOf()).oracleStale) throw new Error("SessionOracle reports the price stale; restart the fork at a fresher block");
      await setAge(1);
      expect((await staleOf()).oracleStale).toBe(true);
      await setAge(86_400);
      expect((await staleOf()).oracleStale).toBe(false);
    } finally {
      await as(chain, owner, () => send(chain, owner, deployment.riskManager, riskManagerAbi, "setMarketConfig", [market.marketId, config]));
    }
  });

  it("serves the session from RiskManager and the oracle", async () => {
    const body = sessionInfo.parse(await (await app.request("/v1/session")).json());
    const closed = await chain.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "isClosedRegime" });
    expect(body.closedRegime).toBe(closed);
  });

  describe("shared formulas match Lens (BE-16)", () => {
    const longUser = randomAddress();
    const shortUser = randomAddress();
    const qqqLong = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "long");
    const qqqShort = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "short");

    beforeAll(async () => {
      if (!qqqLong || !qqqShort) throw new Error("QQQ markets missing from the deployment");
      await openOnMorpho(chain, qqqLong.marketId, longUser, parseUnits("1", 18), parseUnits("300", 6));
      await openOnMorpho(chain, qqqShort.marketId, shortUser, parseUnits("1000", 6), parseUnits("0.5", 18));
    }, 120_000);

    it.each([
      ["long", longUser],
      ["short", shortUser],
    ] as const)("%s: LTV and liquidation price", async (side, user) => {
      const market = side === "long" ? qqqLong! : qqqShort!;
      const [positions, snapshot] = await Promise.all([
        chain.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getPositions", args: [user] }),
        chain.readContract({ address: market.oracle, abi: sessionOracleAbi, functionName: "snapshot" }),
      ]);
      const view = positions.find((p) => p.marketId === market.marketId);
      if (!view) throw new Error("position not found in Lens");

      const stockDecimals = tokens.aQQQ.decimals;
      const quoteDecimals = tokens.USDC.decimals;
      const cautious = cautiousPriceE8(side, { priceE8: snapshot[0], bidE8: snapshot[1], askE8: snapshot[2] });
      const price = morphoOraclePrice(side, cautious, stockDecimals, quoteDecimals);
      const onChainPrice = await chain.readContract({ address: market.oracle, abi: sessionOracleAbi, functionName: "price" });

      expect(price).toBe(onChainPrice);
      expect(positionLtvWad(view.debt, view.collateral, price)).toBe(view.ltv);
      expect(
        liquidationPriceE8(side, { collateral: view.collateral, debt: view.debt, lltvWad: view.lltv, stockDecimals, quoteDecimals }),
      ).toBe(view.liqPriceE8);
    });
  });
});
