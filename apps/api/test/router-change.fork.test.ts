import { readFileSync } from "node:fs";
import { createDb, morphoEvents, protectedPositions, routerCursor, routerEvents, runMigrations, syncCursors } from "@levra/db";
import { external, tokens } from "@levra/shared/addresses";
import { marginRouterAbi, morphoAbi } from "@levra/shared/abis";
import { historyResponse, quoteCloseResponse, quoteOpenResponse } from "@levra/shared/api";
import type { Deployment } from "@levra/shared/deployments";
import { createKyber } from "@levra/swap";
import pino from "pino";
import { createPublicClient, http, parseUnits, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rpcSource } from "../../indexer/src/sources/rpc";
import { morphoStream, routerStream, syncStream } from "../../indexer/src/sync";
import { createApp } from "../src/app";
import { createChainClient } from "../src/chain/client";
import { createChainReader } from "../src/chain/reader";
import { dbEventStore } from "../src/positions/events";
import { as, createForkClient, deal, forkDeployment, forkRpcUrl, forSigning, onFork, openSessionAtDexPrice, randomAddress, seedMarket, send } from "./fork-helpers";

const dbUrl = process.env.TEST_DATABASE_URL;

/** Forge build output, written by the deploy script that made the fork deployment. */
function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

/**
 * A router change on the fork (SC-87, BE-98): a position opened on one router and closed on its replacement is one
 * history, read from the indexer and from the chain alone, and the protector only counts opt-ins on the new router.
 */
describe.skipIf(!onFork || !dbUrl)("a router change (BE-98)", () => {
  const before = forkDeployment();
  const { db, close } = createDb(dbUrl ?? "postgres://unused", { max: 2 });
  const client = createChainClient(143, forkRpcUrl);
  const swap = createKyber({ baseUrl: "https://aggregator-api.kyberswap.com/monad/api/v1", clientId: "levra" });
  const chain = createForkClient(forkRpcUrl);
  const source = rpcSource(createPublicClient({ chain: monad, transport: http(forkRpcUrl) }));
  const user = privateKeyToAccount(generatePrivateKey());
  const market = before.markets.find((m) => m.symbol === "QQQ" && m.side === "long")!;
  let after: Deployment;

  const appFor = (deployment: Deployment, withDb: boolean) => {
    const reader = createChainReader(client, deployment);
    return createApp({ logger: pino({ level: "silent" }), reader, swap, ...(withDb ? { events: dbEventStore(db, 143) } : {}) });
  };
  const call = async (app: ReturnType<typeof appFor>, path: string, payload?: unknown) => {
    const res = await app.request(path, payload === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`${path} failed: ${JSON.stringify(body)}`);
    return body;
  };
  const execute = async (tx: { to: Hex; data: Hex; gasLimit: string }) => {
    const hash = await chain.sendTransaction({ account: user, chain: monad, to: tx.to, data: tx.data, gas: BigInt(tx.gasLimit) });
    expect((await chain.waitForTransactionReceipt({ hash })).status).toBe("success");
  };
  /** Signs whatever the quote still asks for and quotes again with the signatures. */
  const signedQuote = async (app: ReturnType<typeof appFor>, path: string, body: Record<string, unknown>, parse: (b: unknown) => { requirements: { type: string; satisfied: boolean; typedData?: unknown }[] }) => {
    const first = parse(await call(app, path, body));
    const missing = first.requirements.filter((r) => !r.satisfied && r.typedData);
    if (missing.length === 0) return first;
    const signatures = await Promise.all(
      missing.map(async (r) => {
        const typedData = forSigning(r.typedData);
        return {
          type: r.type,
          signature: await user.signTypedData(typedData),
          deadline: Number(typedData.message.deadline),
          ...(r.type === "morphoAuthorization" ? { nonce: typedData.message.nonce.toString() } : {}),
        };
      }),
    );
    return parse(await call(app, path, { ...body, signatures }));
  };
  const index = async (deployment: Deployment) => {
    await syncStream(db, source, deployment, routerStream(deployment));
    await syncStream(db, source, deployment, morphoStream(deployment));
  };

  /** The same steps as `RedeployRouter.s.sol`: a router with the old one's targets and fees, and a Lens bound to it. */
  const redeployRouter = async (): Promise<Deployment> => {
    const old = before.router;
    const read = <T>(functionName: string, args: unknown[] = []) => chain.readContract({ address: old, abi: marginRouterAbi, functionName, args } as never) as Promise<T>;
    const targets = await read<readonly Address[]>("swapTargets");
    const spenders = await Promise.all(targets.map((t) => read<Address>("swapSpender", [t])));
    const [feeBps, keeperFeeBps, feeRecipient] = await Promise.all([read<bigint>("feeBps"), read<bigint>("keeperFeeBps"), read<Address>("feeRecipient")]);
    const deployer = randomAddress();
    return as(chain, deployer, async () => {
      const deploy = async (name: string, args: unknown[]) => {
        const { abi, bytecode } = artifact(name);
        const hash = await chain.deployContract({ account: deployer, chain: monad, abi, bytecode, args });
        const receipt = await chain.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deploy failed`);
        return receipt.contractAddress;
      };
      const router = await deploy("MarginRouter", [external.morpho, before.riskManager, targets, spenders, deployer, feeRecipient, feeBps]);
      await send(chain, deployer, router, artifact("MarginRouter").abi, "setFees", [feeBps, keeperFeeBps, feeRecipient]);
      const lens = await deploy("Lens", [external.morpho, before.riskManager, router]);
      return { ...before, router, lens, previousRouters: [...(before.previousRouters ?? []), old] };
    });
  };

  let snapshotId: Hex;
  beforeAll(async () => {
    snapshotId = await chain.snapshot();
    await runMigrations(dbUrl ?? "");
    await db.delete(routerEvents);
    await db.delete(morphoEvents);
    await db.delete(syncCursors);
    await openSessionAtDexPrice(chain, swap, "QQQ");
    await seedMarket(chain, market.marketId, parseUnits("5000", 6));
    await deal(chain, tokens.USDC.address, user.address, parseUnits("200", 6));
    await chain.setBalance({ address: user.address, value: parseUnits("10", 18) });
    await chain.mine({ blocks: 1 });
  }, 180_000);
  afterAll(async () => {
    await chain.revert({ id: snapshotId });
    await close();
  });

  it("opens on the old router and turns protection on there", { timeout: 180_000 }, async () => {
    const app = appFor(before, true);
    const body = { user: user.address, symbol: "QQQ", side: "long", marginRaw: parseUnits("50", 6).toString(), leverageE2: 200, slippageBps: 100 };
    const quote = quoteOpenResponse.parse(await signedQuote(app, "/v1/quote/open", body, quoteOpenResponse.parse));
    expect(quote.tx.to.toLowerCase()).toBe(before.router.toLowerCase());
    await execute(quote.tx);
    await as(chain, user.address, () => send(chain, user.address, before.router, marginRouterAbi, "setProtection", [market.marketId, true]));
    await index(before);
    expect(await protectedPositions(db, 143, { address: before.router, hasPrevious: false })).toEqual([{ user: user.address.toLowerCase(), marketId: market.marketId }]);
  });

  it("closes on the new router once the user authorizes it, and shows one history from the indexer and from the chain", { timeout: 300_000 }, async () => {
    after = await redeployRouter();
    expect(routerCursor(after)).not.toBe(routerCursor(before));

    const app = appFor(after, true);
    const closeBody = { user: user.address, marketId: market.marketId, fractionWad: (10n ** 18n).toString(), slippageBps: 100 };
    const first = quoteCloseResponse.parse(await call(app, "/v1/quote/close", closeBody));
    expect(first.requirements).toContainEqual(expect.objectContaining({ type: "morphoAuthorization", satisfied: false, spender: after.router }));
    expect(first.tx.gasLimit).toBe("0");
    // As the web app does for a close: authorize the new router on Morpho, then quote again (ManageSheet).
    await as(chain, user.address, () => send(chain, user.address, external.morpho, morphoAbi, "setAuthorization", [after.router, true]));
    const quote = quoteCloseResponse.parse(await call(app, "/v1/quote/close", closeBody));
    expect(quote.requirements.every((r) => r.satisfied)).toBe(true);
    expect(quote.tx.to.toLowerCase()).toBe(after.router.toLowerCase());
    await execute(quote.tx);

    // The new file is a new cursor, so the indexer reads both routers again from the deployment block.
    await index(after);
    const rows = await db.select({ router: routerEvents.router, name: routerEvents.name }).from(routerEvents);
    expect(rows.filter((r) => r.name === "PositionOpened").map((r) => r.router)).toEqual([before.router.toLowerCase()]);
    expect(rows.filter((r) => r.name === "PositionReduced").map((r) => r.router)).toEqual([after.router.toLowerCase()]);

    const history = historyResponse.parse(await call(appFor(after, true), `/v1/accounts/${user.address}/history`));
    expect(history.items.map((i) => [i.type, i.marketId])).toEqual([
      ["close", market.marketId],
      ["open", market.marketId],
    ]);
    // Realized PnL of the close is measured against the margin of the open on the other router.
    const closed = history.items[0]!;
    const gap = BigInt(closed.realizedPnlUsdRaw!) - (BigInt(closed.usdAmountRaw!) - parseUnits("50", 6));
    expect(gap >= -1n && gap <= 1n).toBe(true);

    // Without the indexer the API reads both routers' logs. That store has no hash or time (tests only), so only the
    // fields both stores share are compared.
    const fromChain = (await call(appFor(after, false), `/v1/accounts/${user.address}/history`)) as { items: Record<string, unknown>[] };
    const shared = (i: Record<string, unknown>) => [i.type, i.marketId, i.usdAmountRaw, i.realizedPnlUsdRaw];
    expect(fromChain.items.map(shared)).toEqual(history.items.map(shared));
  });

  it("does not count the opt-in made on the old router", async () => {
    expect(await protectedPositions(db, 143, { address: after.router, hasPrevious: true })).toEqual([]);
  });
});
