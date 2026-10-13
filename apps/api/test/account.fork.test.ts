import { createDb, routerEvents, runMigrations, syncCursors } from "@levra/db";
import { tokens } from "@levra/shared/addresses";
import { lensAbi } from "@levra/shared/abis";
import { account, historyResponse, quoteCloseResponse, quoteOpenResponse } from "@levra/shared/api";
import pino from "pino";
import { createPublicClient, http, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rpcSource } from "../../indexer/src/sources/rpc";
import { syncRouter } from "../../indexer/src/sync";
import { createApp } from "../src/app";
import { createChainClient } from "../src/chain/client";
import { createChainReader } from "../src/chain/reader";
import { dbEventStore } from "../src/positions/events";
import { createKyber } from "../src/swap/kyber";
import { createForkClient, deal, forkDeployment, forkRpcUrl, forSigning, onFork, seedMarket } from "./fork-helpers";

const dbUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!onFork || !dbUrl)("accounts and history from the indexer, on the fork (BE-13, BE-14)", () => {
  const deployment = forkDeployment();
  const { db, close } = createDb(dbUrl ?? "postgres://unused", { max: 2 });
  const reader = createChainReader(createChainClient(forkRpcUrl), deployment);
  const swap = createKyber({ baseUrl: "https://aggregator-api.kyberswap.com/monad/api/v1", clientId: "levra" });
  const app = createApp({ logger: pino({ level: "silent" }), reader, swap, events: dbEventStore(db) });
  const chain = createForkClient(forkRpcUrl);
  const source = rpcSource(createPublicClient({ chain: monad, transport: http(forkRpcUrl) }));
  const user = privateKeyToAccount(generatePrivateKey());
  const market = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "long")!;

  let snapshotId: Hex;
  beforeAll(async () => {
    snapshotId = await chain.snapshot();
    await runMigrations(dbUrl ?? "");
    await db.delete(routerEvents);
    await db.delete(syncCursors);
    await seedMarket(chain, market.marketId, parseUnits("5000", 6));
    await deal(chain, tokens.USDC.address, user.address, parseUnits("200", 6));
    await chain.setBalance({ address: user.address, value: parseUnits("10", 18) });
    await chain.mine({ blocks: 1 });
  }, 120_000);
  afterAll(async () => {
    await chain.revert({ id: snapshotId });
    await close();
  });

  const post = async (path: string, payload: unknown) => {
    const res = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`${path} failed: ${JSON.stringify(body)}`);
    return body;
  };
  const get = async (path: string) => {
    const res = await app.request(path);
    const body = await res.json();
    if (res.status !== 200) throw new Error(`${path} failed: ${JSON.stringify(body)}`);
    return body;
  };
  const send = async (tx: { to: Hex; data: Hex; gasLimit: string }) => {
    const hash = await chain.sendTransaction({ account: user, chain: monad, to: tx.to, data: tx.data, gas: BigInt(tx.gasLimit) });
    expect((await chain.waitForTransactionReceipt({ hash })).status).toBe("success");
  };

  it("shows a newly opened position with its entry price, and the open in the history", { timeout: 180_000 }, async () => {
    const openBody = { user: user.address, symbol: "QQQ", side: "long", marginRaw: parseUnits("50", 6).toString(), leverageE2: 200, slippageBps: 100 };
    const first = quoteOpenResponse.parse(await post("/v1/quote/open", openBody));
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
    const quote = quoteOpenResponse.parse(await post("/v1/quote/open", { ...openBody, signatures }));
    await send(quote.tx);

    expect((await syncRouter(db, source, deployment)).inserted).toBe(1);

    const acc = account.parse(await get(`/v1/accounts/${user.address}`));
    const pos = acc.positions.find((p) => p.marketId === market.marketId);
    if (!pos) throw new Error("position missing from the account");
    const lens = await chain.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getPositions", args: [user.address] });
    expect(pos.collateralRaw).toBe(lens[0]!.collateral.toString());
    expect(pos.debtRaw).toBe(lens[0]!.debt.toString());
    expect(acc.morphoAuthorized).toBe(true);

    // Entry includes the 0.10% fee, so it sits just above the swap price.
    const entry = BigInt(pos.entryPriceE8);
    const exec = BigInt(quote.preview.execPriceE8);
    expect(entry >= exec).toBe(true);
    expect((entry - exec) * 10_000n <= exec * 50n).toBe(true);
    expect(BigInt(acc.totals.unrealizedPnlUsdRaw)).toBe(BigInt(pos.equityUsdRaw) - parseUnits("50", 6));

    const history = historyResponse.parse(await get(`/v1/accounts/${user.address}/history`));
    expect(history.items.map((i) => i.type)).toEqual(["open"]);
  });

  it("records a reduction with its realized PnL", { timeout: 180_000 }, async () => {
    const q = quoteCloseResponse.parse(
      await post("/v1/quote/close", { user: user.address, marketId: market.marketId, fractionWad: (5n * 10n ** 17n).toString(), slippageBps: 100 }),
    );
    await send(q.tx);
    expect((await syncRouter(db, source, deployment)).inserted).toBe(1);

    const history = historyResponse.parse(await get(`/v1/accounts/${user.address}/history`));
    expect(history.items.map((i) => i.type)).toEqual(["reduce", "open"]);
    const reduce = history.items[0]!;
    // Half the stock sold: realized = USDC returned minus half of the $50 margin.
    expect(BigInt(reduce.realizedPnlUsdRaw!)).toBe(BigInt(reduce.usdAmountRaw!) - parseUnits("25", 6));
  });
});
