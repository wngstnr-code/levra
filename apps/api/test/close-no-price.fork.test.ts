import { createKyber } from "@levra/kyber";
import { external, tokens } from "@levra/shared/addresses";
import { lensAbi, morphoAbi, sessionOracleAbi } from "@levra/shared/abis";
import { account, apiError, marketsResponse, quoteCloseResponse, quoteCollateralResponse } from "@levra/shared/api";
import { monadDeployment } from "@levra/shared/deployments/monad";
import { stocks } from "@levra/shared/markets";
import pino from "pino";
import { erc20Abi, parseUnits, type Address, type Hex } from "viem";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createChainClient } from "../src/chain/client";
import { createChainReader } from "../src/chain/reader";
import { as, createForkClient, forkDeployment, forkRpcUrl, onFork, openOnMorpho, randomAddress, refreshAnchoredPrice, send } from "./fork-helpers";

/**
 * Code that reverts on every call with no data. Put on Anchored's oracle, every SessionOracle's `snapshot()` and
 * `price()` revert while the rest of our contracts answer. Anchored itself refuses a price of zero or below.
 */
const ALWAYS_REVERTS: Hex = "0x60006000fd";

describe.skipIf(!onFork)("closing without an oracle price (BE-99)", () => {
  const deployment = forkDeployment();
  const client = createChainClient(143, forkRpcUrl);
  const reader = createChainReader(client, deployment);
  const swap = createKyber({ baseUrl: "https://aggregator-api.kyberswap.com/monad/api/v1", clientId: "levra" });
  const app = createApp({ logger: pino({ level: "silent" }), reader, swap });
  const chain = createForkClient(forkRpcUrl);
  const long = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "long")!;
  const short = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "short")!;
  const user = randomAddress();

  let snapshotId: Hex;
  beforeAll(async () => {
    snapshotId = await chain.snapshot();
    await refreshAnchoredPrice(chain, stocks.QQQ.priceId);
    const [priceE8] = await chain.readContract({ address: long.oracle, abi: sessionOracleAbi, functionName: "snapshot" });
    const shareUsdc = priceE8 / 100n;
    // One aQQQ long at 40% LTV, and one aQQQ borrowed against twice its value in USDC.
    await openOnMorpho(chain, long.marketId, user, parseUnits("1", 18), (shareUsdc * 40n) / 100n);
    await openOnMorpho(chain, short.marketId, user, shareUsdc * 2n, parseUnits("1", 18));
    await as(chain, user, () => send(chain, user, reader.morpho, morphoAbi, "setAuthorization", [deployment.router, true]));

    await chain.setCode({ address: external.anchoredStockOracle, bytecode: ALWAYS_REVERTS });
    await chain.mine({ blocks: 1 });
  }, 300_000);
  afterAll(async () => {
    await chain.revert({ id: snapshotId });
  });

  const request = async (path: string, payload?: unknown) => {
    const res = await app.request(path, payload === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return { status: res.status, body: (await res.json()) as unknown };
  };
  const ok = async (path: string, payload?: unknown) => {
    const { status, body } = await request(path, payload);
    if (status !== 200) throw new Error(`${path} answered ${status}: ${JSON.stringify(body)}`);
    return body;
  };
  const position = async (marketId: Hex) => {
    const positions = await chain.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getPositions", args: [user] });
    return positions.find((p) => p.marketId === marketId);
  };
  const execute = (tx: { to: Address; data: Hex; gasLimit: string }) =>
    as(chain, user, async () => {
      expect(BigInt(tx.gasLimit) > 0n).toBe(true);
      const hash = await chain.sendTransaction({ account: user, chain: monad, to: tx.to, data: tx.data, gas: BigInt(tx.gasLimit) });
      expect((await chain.waitForTransactionReceipt({ hash })).status).toBe("success");
    });
  const routerHoldsNothing = async () => {
    for (const token of [tokens.USDC.address, tokens.aQQQ.address]) {
      expect(await chain.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [deployment.router] })).toBe(0n);
    }
  };

  it("knows which routers close without a price: the fork's has SC-86, the live Monad one does not", { timeout: 60_000 }, async () => {
    expect(await reader.closesWithoutPrice()).toBe(true);
    expect(await createChainReader(client, monadDeployment).closesWithoutPrice()).toBe(false);
  });

  it("answers every route that reads the market, and refuses opening and a partial close with a clear error", { timeout: 120_000 }, async () => {
    const markets = marketsResponse.parse(await ok("/v1/markets"));
    for (const m of markets.markets.filter((x) => x.symbol === "QQQ")) expect(m).toMatchObject({ oraclePriceE8: "0", oracleStale: true });
    await ok("/v1/143/markets/QQQ");

    const acc = account.parse(await ok(`/v1/accounts/${user}`));
    expect(acc.positions.map((p) => [p.side, p.oraclePriceE8, p.valueUsdRaw])).toEqual(
      expect.arrayContaining([
        ["long", "0", "0"],
        ["short", "0", "0"],
      ]),
    );
    expect(acc.totals.equityUsdRaw).toBe("0");

    const add = quoteCollateralResponse.parse(await ok("/v1/quote/collateral", { user, marketId: long.marketId, action: "add", amountRaw: (10n ** 17n).toString() }));
    expect(add.warnings).toContainEqual(expect.objectContaining({ code: "ORACLE_STALE", severity: "info" }));

    const open = await request("/v1/quote/open", { user, symbol: "QQQ", side: "long", marginRaw: "50000000", leverageE2: 200, slippageBps: 100 });
    expect(open.status).toBe(400);
    expect(apiError.parse(open.body).error.message).toMatch(/no price/);

    const half = await request("/v1/quote/close", { user, marketId: long.marketId, fractionWad: (5n * 10n ** 17n).toString(), slippageBps: 100 });
    expect(half.status).toBe(400);
    expect(apiError.parse(half.body).error.message).toMatch(/Only a full close works/);
  });

  for (const side of ["long", "short"] as const) {
    it(`closes a ${side} in full through the router from the DEX price alone`, { timeout: 180_000 }, async () => {
      const market = side === "long" ? long : short;
      const q = quoteCloseResponse.parse(await ok("/v1/quote/close", { user, marketId: market.marketId, fractionWad: (10n ** 18n).toString(), slippageBps: 100 }));
      expect(q.warnings).toContainEqual(expect.objectContaining({ code: "ORACLE_STALE", severity: "warn" }));
      expect(q.warnings.filter((w) => w.severity === "block")).toEqual([]);
      expect(q.preview).toMatchObject({ oraclePriceE8: "0", deviationBps: 0, ltvAfterWad: "0" });

      await execute(q.tx);
      expect(await position(market.marketId)).toBeUndefined();
      await routerHoldsNothing();
    });
  }
});
