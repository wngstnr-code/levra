import { tokens } from "@levra/shared/addresses";
import { lensAbi } from "@levra/shared/abis";
import { quoteOpenResponse, type QuoteOpenResponse } from "@levra/shared/api";
import { readDeployment } from "@levra/shared/deployments/node";
import pino from "pino";
import { parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createChainClient } from "../src/chain/client";
import { createChainReader } from "../src/chain/reader";
import { createKyber } from "../src/swap/kyber";
import { createForkClient, deal, forkDeploymentFile, forkRpcUrl, onFork, seedMarket } from "./fork-helpers";

/** Turns the decimal strings of uint256 fields back into bigint for signing, as the web app does. */
function forSigning(typedData: any) {
  const uints = new Set(
    Object.values(typedData.types as Record<string, { name: string; type: string }[]>)
      .flat()
      .filter((f) => f.type.startsWith("uint"))
      .map((f) => f.name),
  );
  const message = Object.fromEntries(Object.entries(typedData.message).map(([k, v]) => [k, uints.has(k) ? BigInt(v as string) : v]));
  return { ...typedData, message };
}

describe.skipIf(!onFork)("quote for opening a long, executed on the fork (BE-12)", () => {
  const deployment = readDeployment(forkDeploymentFile ?? "");
  const reader = createChainReader(createChainClient(forkRpcUrl ?? ""), deployment);
  const swap = createKyber({ baseUrl: "https://aggregator-api.kyberswap.com/monad/api/v1", clientId: "levra" });
  const app = createApp({ logger: pino({ level: "silent" }), reader, swap });
  const chain = createForkClient(forkRpcUrl ?? "");
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
});
