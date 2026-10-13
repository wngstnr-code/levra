import { tokens } from "@levra/shared/addresses";
import { lensAbi } from "@levra/shared/abis";
import { quoteCloseResponse, quoteCollateralResponse, quoteOpenResponse, type QuoteOpenResponse } from "@levra/shared/api";
import pino from "pino";
import { erc20Abi, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createChainClient } from "../src/chain/client";
import { createChainReader } from "../src/chain/reader";
import { createKyber } from "../src/swap/kyber";
import { createForkClient, deal, forkDeployment, forkRpcUrl, forSigning, onFork, seedMarket } from "./fork-helpers";

describe.skipIf(!onFork)("long quotes executed on the fork (BE-12)", () => {
  const deployment = forkDeployment();
  const reader = createChainReader(createChainClient(forkRpcUrl), deployment);
  const swap = createKyber({ baseUrl: "https://aggregator-api.kyberswap.com/monad/api/v1", clientId: "levra" });
  const app = createApp({ logger: pino({ level: "silent" }), reader, swap });
  const chain = createForkClient(forkRpcUrl);
  const user = privateKeyToAccount(generatePrivateKey());
  const market = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "long")!;
  const margin = parseUnits("50", 6);

  let snapshotId: Hex;
  beforeAll(async () => {
    snapshotId = await chain.snapshot();
    await seedMarket(chain, market.marketId, parseUnits("5000", 6));
    await deal(chain, tokens.USDC.address, user.address, parseUnits("200", 6));
    await chain.setBalance({ address: user.address, value: parseUnits("10", 18) });
    await chain.mine({ blocks: 1 });
  }, 120_000);
  afterAll(async () => {
    await chain.revert({ id: snapshotId });
  });

  const quote = async (signatures?: unknown[]): Promise<QuoteOpenResponse> => {
    const res = await app.request("/v1/quote/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: user.address, symbol: "QQQ", side: "long", marginRaw: margin.toString(), leverageE2: 200, slippageBps: 100, signatures }),
    });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`quote failed: ${JSON.stringify(body)}`);
    return quoteOpenResponse.parse(body);
  };

  it("asks for signatures on first use, then returns one multicall that opens the position", { timeout: 120_000 }, async () => {
    const first = await quote();
    expect(first.requirements.map((r) => [r.type, r.satisfied])).toEqual([
      ["approve", false],
      ["morphoAuthorization", false],
    ]);
    expect(first.tx.gasLimit).toBe("0");

    const signatures = await Promise.all(
      first.requirements.map(async (r) => {
        const typedData = forSigning(r.typedData);
        return {
          type: r.type,
          signature: await user.signTypedData(typedData),
          deadline: Number(typedData.message.deadline),
          ...(r.type === "morphoAuthorization" ? { nonce: typedData.message.nonce.toString() } : {}),
        };
      }),
    );

    const second = await quote(signatures);
    expect(second.warnings.filter((w) => w.severity === "block")).toEqual([]);
    expect(BigInt(second.tx.gasLimit) > 0n).toBe(true);

    const hash = await chain.sendTransaction({ account: user, chain: monad, to: second.tx.to, data: second.tx.data, gas: BigInt(second.tx.gasLimit) });
    const receipt = await chain.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    const positions = await chain.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getPositions", args: [user.address] });
    const position = positions.find((p) => p.marketId === market.marketId);
    if (!position) throw new Error("no position after opening");

    const expected = BigInt(second.preview.stockAmountRaw);
    expect(position.collateral >= (expected * 9_900n) / 10_000n).toBe(true);
    expect(position.debt >= BigInt(second.preview.debtRaw)).toBe(true);
    expect(position.debt - BigInt(second.preview.debtRaw) < 10n).toBe(true);
    const ltvGap = position.ltv > BigInt(second.preview.ltvAfterWad) ? position.ltv - BigInt(second.preview.ltvAfterWad) : BigInt(second.preview.ltvAfterWad) - position.ltv;
    expect(ltvGap * 10_000n <= BigInt(second.preview.ltvAfterWad) * 100n).toBe(true);
  });

  it("returns a ready transaction without signatures once the approvals are in place", { timeout: 60_000 }, async () => {
    const next = await quote();
    expect(next.requirements.find((r) => r.type === "morphoAuthorization")?.satisfied).toBe(true);
  });

  const post = async (path: string, payload: unknown) => {
    const res = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`${path} failed: ${JSON.stringify(body)}`);
    return body;
  };
  const execute = async (tx: { to: `0x${string}`; data: `0x${string}`; gasLimit: string }) => {
    expect(BigInt(tx.gasLimit) > 0n).toBe(true);
    const hash = await chain.sendTransaction({ account: user, chain: monad, to: tx.to, data: tx.data, gas: BigInt(tx.gasLimit) });
    expect((await chain.waitForTransactionReceipt({ hash })).status).toBe("success");
  };
  const position = async () => {
    const positions = await chain.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getPositions", args: [user.address] });
    return positions.find((p) => p.marketId === market.marketId);
  };
  const usdc = () => chain.readContract({ address: tokens.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [user.address] });

  it("reduces half of the position from the close quote", { timeout: 120_000 }, async () => {
    const before = (await position())!;
    const q = quoteCloseResponse.parse(
      await post("/v1/quote/close", { user: user.address, marketId: market.marketId, fractionWad: (5n * 10n ** 17n).toString(), slippageBps: 100 }),
    );
    expect(q.warnings.filter((w) => w.severity === "block")).toEqual([]);
    const usdcBefore = await usdc();
    await execute(q.tx);

    const after = (await position())!;
    expect(after.collateral).toBe(before.collateral - BigInt(q.preview.collateralWithdrawnRaw));
    const received = (await usdc()) - usdcBefore;
    expect(received * 10_000n >= BigInt(q.preview.returnedRaw) * 9_800n).toBe(true);
  });

  it("removes a little collateral from the collateral quote", { timeout: 120_000 }, async () => {
    const before = (await position())!;
    const amount = before.collateral / 20n;
    const q = quoteCollateralResponse.parse(
      await post("/v1/quote/collateral", { user: user.address, marketId: market.marketId, action: "remove", amountRaw: amount.toString() }),
    );
    expect(q.warnings.filter((w) => w.severity === "block")).toEqual([]);
    await execute(q.tx);
    const after = (await position())!;
    expect(after.collateral.toString()).toBe(q.preview.collateralAfterRaw);
    expect(after.ltv - BigInt(q.preview.ltvAfterWad) < 10n ** 12n).toBe(true);
  });

  it("closes the rest from the close quote and leaves nothing in the router", { timeout: 120_000 }, async () => {
    const q = quoteCloseResponse.parse(
      await post("/v1/quote/close", { user: user.address, marketId: market.marketId, fractionWad: (10n ** 18n).toString(), slippageBps: 100 }),
    );
    const usdcBefore = await usdc();
    await execute(q.tx);
    expect(await position()).toBeUndefined();
    const received = (await usdc()) - usdcBefore;
    expect(received * 10_000n >= BigInt(q.preview.returnedRaw) * 9_800n).toBe(true);
    const routerUsdc = await chain.readContract({ address: tokens.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [deployment.router] });
    expect(routerUsdc).toBe(0n);
  });
});
