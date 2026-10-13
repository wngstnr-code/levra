import { createKyber, KYBER_MONAD_URL } from "@levra/kyber";
import { tokens } from "@levra/shared/addresses";
import { lensAbi } from "@levra/shared/abis";
import { quoteCloseResponse, quoteOpenResponse } from "@levra/shared/api";
import pino from "pino";
import { erc20Abi, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createChainClient } from "../src/chain/client";
import { createChainReader } from "../src/chain/reader";
import { createForkClient, deal, forkDeployment, forkRpcUrl, forSigning, onFork, seedMarket } from "./fork-helpers";

describe.skipIf(!onFork)("short quotes executed on the fork (BE-20)", () => {
  const deployment = forkDeployment();
  const reader = createChainReader(createChainClient(forkRpcUrl), deployment);
  const app = createApp({ logger: pino({ level: "silent" }), reader, swap: createKyber({ baseUrl: KYBER_MONAD_URL, clientId: "levra" }) });
  const chain = createForkClient(forkRpcUrl);
  const user = privateKeyToAccount(generatePrivateKey());
  const market = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "short")!;

  let snapshotId: Hex;
  beforeAll(async () => {
    snapshotId = await chain.snapshot();
    // Lenders supply aQQQ, the stock a short borrows.
    await seedMarket(chain, market.marketId, parseUnits("2", 18));
    await deal(chain, tokens.USDC.address, user.address, parseUnits("200", 6));
    await chain.setBalance({ address: user.address, value: parseUnits("10", 18) });
    await chain.mine({ blocks: 1 });
  }, 120_000);
  afterAll(async () => {
    await chain.revert({ id: snapshotId });
  });

  const post = async (path: string, payload: unknown) => {
    const res = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`${path} failed: ${JSON.stringify(body)}`);
    return body;
  };
  const send = async (tx: { to: Hex; data: Hex; gasLimit: string }) => {
    expect(BigInt(tx.gasLimit) > 0n).toBe(true);
    const hash = await chain.sendTransaction({ account: user, chain: monad, to: tx.to, data: tx.data, gas: BigInt(tx.gasLimit) });
    expect((await chain.waitForTransactionReceipt({ hash })).status).toBe("success");
  };
  const position = async () => {
    const all = await chain.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getPositions", args: [user.address] });
    return all.find((p) => p.marketId === market.marketId);
  };
  const balance = (token: Hex, who: Hex = user.address) => chain.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

  it("opens a short in one multicall after the first-use signatures", { timeout: 180_000 }, async () => {
    const body = { user: user.address, symbol: "QQQ", side: "short", marginRaw: parseUnits("50", 6).toString(), leverageE2: 100, slippageBps: 100 };
    const first = quoteOpenResponse.parse(await post("/v1/quote/open", body));
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
    const q = quoteOpenResponse.parse(await post("/v1/quote/open", { ...body, signatures }));
    expect(q.warnings.filter((w) => w.severity === "block")).toEqual([]);
    await send(q.tx);

    const p = (await position())!;
    expect(p.debt >= BigInt(q.preview.debtRaw)).toBe(true);
    expect(p.debt - BigInt(q.preview.debtRaw) < 10n ** 12n).toBe(true);
    // Collateral is margin plus the real sale proceeds less the fee: within the slippage of the preview.
    expect(p.collateral * 10_000n >= BigInt(q.preview.collateralRaw) * 9_900n).toBe(true);
  });

  it("reduces half of the short from the close quote", { timeout: 180_000 }, async () => {
    const before = (await position())!;
    const q = quoteCloseResponse.parse(await post("/v1/quote/close", { user: user.address, marketId: market.marketId, fractionWad: (5n * 10n ** 17n).toString(), slippageBps: 100 }));
    expect(q.warnings.filter((w) => w.severity === "block")).toEqual([]);
    const usdcBefore = await balance(tokens.USDC.address);
    await send(q.tx);
    const after = (await position())!;
    expect(before.debt - after.debt >= BigInt(q.preview.debtRepaidRaw) - 10n ** 12n).toBe(true);
    expect((await balance(tokens.USDC.address)) - usdcBefore >= BigInt(q.preview.returnedRaw) - BigInt(q.preview.returnedRaw) / 1_000n).toBe(true);
  });

  it("closes the rest, repays all the stock and leaves nothing in the router", { timeout: 180_000 }, async () => {
    const q = quoteCloseResponse.parse(await post("/v1/quote/close", { user: user.address, marketId: market.marketId, fractionWad: (10n ** 18n).toString(), slippageBps: 100 }));
    expect(q.warnings.filter((w) => w.severity === "block")).toEqual([]);
    // The close buys a bit more stock than it owes; the leftover goes to the wallet.
    expect(BigInt(q.preview.stockAmountRaw) > BigInt(q.preview.debtRepaidRaw)).toBe(true);
    const stockBefore = await balance(tokens.aQQQ.address);
    await send(q.tx);
    expect(await position()).toBeUndefined();
    expect((await balance(tokens.aQQQ.address)) > stockBefore).toBe(true);
    for (const token of [tokens.USDC.address, tokens.aQQQ.address]) expect(await balance(token, deployment.router)).toBe(0n);
  });
});
