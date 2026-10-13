import { external, tokens } from "@levra/shared/addresses";
import { lensAbi, morphoAbi, riskManagerAbi, sessionOracleAbi } from "@levra/shared/abis";
import { marketsResponse, sessionInfo } from "@levra/shared/api";
import { readDeployment } from "@levra/shared/deployments/node";
import {
  cautiousPriceE8,
  collateralValue,
  liquidationPriceE8,
  maxLeverageE2,
  morphoOraclePrice,
  positionLtvWad,
} from "@levra/shared/math";
import pino from "pino";
import {
  createTestClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  parseUnits,
  publicActions,
  toHex,
  walletActions,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createChainClient } from "../src/chain/client";
import { createChainReader } from "../src/chain/reader";

const rpcUrl = process.env.FORK_RPC_URL;
const deploymentFile = process.env.FORK_DEPLOYMENT_FILE;

describe.skipIf(!rpcUrl || !deploymentFile)("on the local fork (needs FORK_RPC_URL and FORK_DEPLOYMENT_FILE)", () => {
  // Collecting a skipped suite still runs this body, so read the file only when the fork is configured.
  const deployment =
    rpcUrl && deploymentFile
      ? readDeployment(deploymentFile)
      : { chainId: 143, block: 0, router: zeroAddress, riskManager: zeroAddress, lens: zeroAddress, markets: [] };
  const reader = createChainReader(createChainClient(rpcUrl ?? ""), deployment);
  const app = createApp({ logger: pino({ level: "silent" }), reader });
  const chain = createTestClient({ chain: monad, mode: "anvil", transport: http(rpcUrl) }).extend(publicActions).extend(walletActions);

  let snapshotId: Hex;
  beforeAll(async () => {
    snapshotId = await chain.snapshot();
  });
  afterAll(async () => {
    await chain.revert({ id: snapshotId });
  });

  const randomAddress = () => privateKeyToAddress(generatePrivateKey());

  async function as<T>(who: Address, run: () => Promise<T>): Promise<T> {
    await chain.impersonateAccount({ address: who });
    await chain.setBalance({ address: who, value: parseUnits("100", 18) });
    try {
      return await run();
    } finally {
      await chain.stopImpersonatingAccount({ address: who });
    }
  }

  async function send(from: Address, address: Address, abi: any, functionName: string, args: unknown[]) {
    const hash = await chain.writeContract({ account: from, chain: monad, address, abi, functionName, args } as any);
    const receipt = await chain.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  }

  /** Like forge's `deal`: finds the balance mapping slot by writing candidates and reading `balanceOf` back. */
  async function deal(token: Address, to: Address, amount: bigint) {
    const value = toHex(amount, { size: 32 });
    for (let slot = 0n; slot < 64n; slot++) {
      for (const key of [
        keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [to, slot])),
        keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [slot, to])),
      ]) {
        const before = await chain.getStorageAt({ address: token, slot: key });
        await chain.setStorageAt({ address: token, index: key, value });
        const balance = await chain.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [to] });
        if (balance === amount) return;
        await chain.setStorageAt({ address: token, index: key, value: before ?? toHex(0n, { size: 32 }) });
      }
    }
    throw new Error(`No balance slot found for ${token}`);
  }

  /** Supplies liquidity, then opens a position straight on Morpho for a fresh address. */
  async function openOnMorpho(marketId: Hex, user: Address, collateral: bigint, borrow: bigint) {
    const params = await chain.readContract({ address: external.morpho, abi: morphoAbi, functionName: "idToMarketParams", args: [marketId] });
    const lender = randomAddress();
    await deal(params.loanToken, lender, borrow * 4n);
    await as(lender, async () => {
      await send(lender, params.loanToken, erc20Abi, "approve", [external.morpho, borrow * 4n]);
      await send(lender, external.morpho, morphoAbi, "supply", [params, borrow * 4n, 0n, lender, "0x"]);
    });
    await deal(params.collateralToken, user, collateral);
    await as(user, async () => {
      await send(user, params.collateralToken, erc20Abi, "approve", [external.morpho, collateral]);
      await send(user, external.morpho, morphoAbi, "supplyCollateral", [params, collateral, user, "0x"]);
      await send(user, external.morpho, morphoAbi, "borrow", [params, borrow, 0n, user, user]);
    });
  }

  it("serves markets whose numbers match direct reads from the contracts", async () => {
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

    const before = await staleOf();
    if (before.oracleStale) throw new Error("oracle is already stale on this fork; restart the fork at a fresher block");
    await as(owner, () => send(owner, deployment.riskManager, riskManagerAbi, "setMarketConfig", [market.marketId, { ...config, maxOracleAge: 1 }]));
    try {
      expect((await staleOf()).oracleStale).toBe(true);
    } finally {
      await as(owner, () => send(owner, deployment.riskManager, riskManagerAbi, "setMarketConfig", [market.marketId, config]));
    }
    expect((await staleOf()).oracleStale).toBe(false);
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
      await openOnMorpho(qqqLong.marketId, longUser, parseUnits("1", 18), parseUnits("300", 6));
      await openOnMorpho(qqqShort.marketId, shortUser, parseUnits("1000", 6), parseUnits("0.5", 18));
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
      expect(collateralValue(view.collateral, price) > 0n).toBe(true);
      expect(
        liquidationPriceE8(side, { collateral: view.collateral, debt: view.debt, lltvWad: view.lltv, stockDecimals, quoteDecimals }),
      ).toBe(view.liqPriceE8);
    });
  });
});
