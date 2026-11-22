import { createDb, morphoEvents, runMigrations, syncCursors } from "@levra/db";
import { createKyber, KYBER_MONAD_URL } from "@levra/kyber";
import { external, tokens } from "@levra/shared/addresses";
import { liquidatorAbi, morphoAbi, sessionOracleAbi } from "@levra/shared/abis";
import { stocks } from "@levra/shared/markets";
import { eq } from "drizzle-orm";
import pino from "pino";
import { createPublicClient, createWalletClient, erc20Abi, http, keccak256, parseAbi, parseUnits, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createForkClient, forkDeployment, forkRpcUrl, onFork, openOnMorpho, randomAddress, refreshAnchoredPrice } from "../../api/test/fork-helpers";

/** Anchored's id for QQQ: keccak256 of the uppercase symbol (03). */
const QQQ_PRICE_ID = keccak256(toBytes("QQQ"));
import { rpcSource } from "../../indexer/src/sources/rpc";
import { MORPHO_CURSOR, morphoStream, syncStream } from "../../indexer/src/sync";
import { createLiquidatorBot } from "../src/liquidator/bot";

const dbUrl = process.env.TEST_DATABASE_URL;
/** Third Anvil test account. Deploy the fork with KEEPER set to its address. Never holds real funds. */
const KEEPER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

/** Test only: the Anchored oracle's operator write, which only a fork lets us call. */
const operatorAbi = parseAbi([
  "function OPERATOR_ROLE() view returns (bytes32)",
  "function getRoleMember(bytes32 role, uint256 index) view returns (address)",
  "function updatePrice((bytes32 priceId, int256 price, int256 bestBid, int256 bestAsk, uint64 feedUpdateTimestamp, uint8 session) p)",
]);

describe.skipIf(!onFork || !dbUrl)("liquidator bot on the fork (BE-32)", () => {
  const deployment = forkDeployment();
  const { db, close } = createDb(dbUrl ?? "postgres://unused", { max: 2 });
  const client = createPublicClient({ chain: monad, transport: http(forkRpcUrl) });
  const chain = createForkClient(forkRpcUrl);
  const wallet = createWalletClient({ account: privateKeyToAccount(KEEPER_KEY), chain: monad, transport: http(forkRpcUrl) });
  const swap = createKyber({ baseUrl: KYBER_MONAD_URL, clientId: "levra" });
  const ctx = { db, chainId: 143 as const, logger: pino({ level: "silent" }), signal: new AbortController().signal };
  const market = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "long")!;
  const risky = randomAddress();
  const safe = randomAddress();

  let snapshot: Hex;
  beforeAll(async () => {
    snapshot = await chain.snapshot();
    await runMigrations(dbUrl ?? "");
    await db.delete(morphoEvents);
    await db.delete(syncCursors).where(eq(syncCursors.name, MORPHO_CURSOR));
  }, 60_000);
  afterAll(async () => {
    await chain.revert({ id: snapshot });
    await close();
  });

  const position = async (who: Hex) => chain.readContract({ address: external.morpho, abi: morphoAbi, functionName: "position", args: [market.marketId, who] });

  it("liquidates a position pushed past the hard limit after interest accrued, with a zero loss budget (BE-89), leaves a healthy one alone, and keeps no tokens", { timeout: 300_000 }, async () => {
    // One aQQQ each, borrowing 73% of its oracle value (close to the 77% limit) and 40% (far from it). Sized from the
    // oracle so the test does not depend on where QQQ trades on the day the fork is made. A fork made while the feed is
    // quiet (a weekend) has a stale price that Morpho's borrow refuses, so it is posted again first.
    await refreshAnchoredPrice(chain, QQQ_PRICE_ID);
    const [priceE8] = await chain.readContract({ address: market.oracle, abi: sessionOracleAbi, functionName: "snapshot" });
    const shareUsdc = priceE8 / 100n;
    await openOnMorpho(chain, market.marketId, risky, parseUnits("1", 18), (shareUsdc * 73n) / 100n);
    await openOnMorpho(chain, market.marketId, safe, parseUnits("1", 18), (shareUsdc * 40n) / 100n);
    await syncStream(db, rpcSource(client), deployment, morphoStream(deployment));

    const bot = createLiquidatorBot({ client, wallet, deployment, swap });
    const calm = (await bot.run(ctx)) as { borrowers: number; unhealthy: number };
    expect(calm).toMatchObject({ unhealthy: 0 });
    expect(calm.borrowers >= 2).toBe(true);

    // Ten minutes pass with nobody touching the market, so Morpho's stored totals fall behind the interest owed. The
    // liquidator has no loss budget, so a sizing from the stored totals that ends a wei short would revert LossTooLarge.
    // Not longer: the KyberSwap route is built against real time and expires about 20 minutes after it is made.
    const liquidator = deployment.liquidator!;
    expect(await chain.readContract({ address: liquidator, abi: liquidatorAbi, functionName: "lossBudgetOf", args: [tokens.USDC.address] })).toBe(0n);
    await chain.increaseTime({ seconds: 600 });
    await chain.mine({ blocks: 1 });
    const stored = await chain.readContract({ address: external.morpho, abi: morphoAbi, functionName: "market", args: [market.marketId] });
    expect(Number(stored.lastUpdate) < Number((await chain.getBlock()).timestamp) - 500).toBe(true);

    // Push the QQQ price down 12% as the oracle operator.
    const oracle = external.anchoredStockOracle;
    const role = await chain.readContract({ address: oracle, abi: operatorAbi, functionName: "OPERATOR_ROLE" });
    const operator = await chain.readContract({ address: oracle, abi: operatorAbi, functionName: "getRoleMember", args: [role, 0n] });
    const now = await chain.readContract({
      address: oracle,
      abi: parseAbi(["function latestPrice(bytes32) view returns ((int128 price, int128 bestBid, int128 bestAsk, uint64 feedUpdateTimestamp, uint64 publishedAt, uint80 roundId, uint8 session))"]),
      functionName: "latestPrice",
      args: [stocks.QQQ.priceId],
    });
    const down = (v: bigint) => (v * 88n) / 100n;
    const block = await chain.getBlock();
    await as(chain, operator, async () => {
      const hash = await chain.writeContract({
        account: operator,
        chain: monad,
        address: oracle,
        abi: operatorAbi,
        functionName: "updatePrice",
        args: [{ priceId: stocks.QQQ.priceId, price: down(now.price), bestBid: down(now.bestBid), bestAsk: down(now.bestAsk), feedUpdateTimestamp: block.timestamp, session: now.session }],
      });
      expect((await chain.waitForTransactionReceipt({ hash })).status).toBe("success");
    });

    const before = await position(risky);
    const result = (await bot.run(ctx)) as { unhealthy: number; actions: { borrower: string; tx?: string; skipped?: string }[] };
    expect(result.unhealthy).toBe(1);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ borrower: risky });
    expect(result.actions[0]!.tx).toBeDefined();

    const after = await position(risky);
    expect(after.borrowShares < before.borrowShares).toBe(true);
    expect(after.collateral < before.collateral).toBe(true);
    expect((await position(safe)).collateral).toBe(parseUnits("1", 18));
    expect(await chain.readContract({ address: liquidator, abi: liquidatorAbi, functionName: "lossBudgetOf", args: [tokens.USDC.address] })).toBe(0n);

    for (const token of [tokens.USDC.address, tokens.aQQQ.address]) {
      expect(await chain.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [liquidator] })).toBe(0n);
    }
  });

  it("liquidates a short pushed past the hard limit by buying the stock back", { timeout: 300_000 }, async () => {
    const short = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "short")!;
    const borrower = randomAddress();
    // One aQQQ share borrowed against USDC worth it at 70% LTV, sized from the oracle (the first test cut the price).
    await refreshAnchoredPrice(chain, QQQ_PRICE_ID);
    const [priceE8] = await chain.readContract({ address: short.oracle, abi: sessionOracleAbi, functionName: "snapshot" });
    await openOnMorpho(chain, short.marketId, borrower, (priceE8 / 100n) * 100n / 70n, parseUnits("1", 18));
    await syncStream(db, rpcSource(client), deployment, morphoStream(deployment));

    // Raise the price 25%, so the debt goes from 70% to about 87% of the collateral, past the 77% limit.
    const oracle = external.anchoredStockOracle;
    const role = await chain.readContract({ address: oracle, abi: operatorAbi, functionName: "OPERATOR_ROLE" });
    const operator = await chain.readContract({ address: oracle, abi: operatorAbi, functionName: "getRoleMember", args: [role, 0n] });
    const now = await chain.readContract({
      address: oracle,
      abi: parseAbi(["function latestPrice(bytes32) view returns ((int128 price, int128 bestBid, int128 bestAsk, uint64 feedUpdateTimestamp, uint64 publishedAt, uint80 roundId, uint8 session))"]),
      functionName: "latestPrice",
      args: [stocks.QQQ.priceId],
    });
    const up = (v: bigint) => (v * 125n) / 100n;
    const block = await chain.getBlock();
    await as(chain, operator, async () => {
      const hash = await chain.writeContract({
        account: operator,
        chain: monad,
        address: oracle,
        abi: operatorAbi,
        functionName: "updatePrice",
        args: [{ priceId: stocks.QQQ.priceId, price: up(now.price), bestBid: up(now.bestBid), bestAsk: up(now.bestAsk), feedUpdateTimestamp: block.timestamp, session: now.session }],
      });
      expect((await chain.waitForTransactionReceipt({ hash })).status).toBe("success");
    });

    const before = await chain.readContract({ address: external.morpho, abi: morphoAbi, functionName: "position", args: [short.marketId, borrower] });
    const bot = createLiquidatorBot({ client, wallet, deployment, swap });
    const result = (await bot.run(ctx)) as { actions: { borrower: string; side: string; tx?: string; skipped?: string }[] };
    const action = result.actions.find((a) => a.borrower === borrower);
    expect(action).toMatchObject({ side: "short" });
    expect(action?.tx).toBeDefined();

    const after = await chain.readContract({ address: external.morpho, abi: morphoAbi, functionName: "position", args: [short.marketId, borrower] });
    expect(after.borrowShares < before.borrowShares).toBe(true);
    for (const token of [tokens.USDC.address, tokens.aQQQ.address]) {
      expect(await chain.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [deployment.liquidator!] })).toBe(0n);
    }
  });
});
