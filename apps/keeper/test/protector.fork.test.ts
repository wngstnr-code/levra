import { createDb, routerEvents, runMigrations, syncCursors } from "@levra/db";
import { createKyber, KYBER_MONAD_URL } from "@levra/kyber";
import { external, tokens } from "@levra/shared/addresses";
import { lensAbi, marginRouterAbi, morphoAbi } from "@levra/shared/abis";
import { WAD, mulDiv, stockForUsd } from "@levra/shared/math";
import { eq } from "drizzle-orm";
import pino from "pino";
import { createPublicClient, createWalletClient, http, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createForkClient, forkDeployment, forkRpcUrl, onFork, openOnMorpho, randomAddress, send } from "../../api/test/fork-helpers";
import { rpcSource } from "../../indexer/src/sources/rpc";
import { ROUTER_CURSOR, routerStream, syncStream } from "../../indexer/src/sync";
import { createProtector, TARGET_BELOW_SOFT_WAD } from "../src/protector/protector";

const dbUrl = process.env.TEST_DATABASE_URL;
/** Third Anvil test account. Deploy the fork with KEEPER set to its address. Never holds real funds. */
const KEEPER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

describe.skipIf(!onFork || !dbUrl)("protector on the fork (BE-31)", () => {
  const deployment = forkDeployment();
  const { db, close } = createDb(dbUrl ?? "postgres://unused", { max: 2 });
  const client = createPublicClient({ chain: monad, transport: http(forkRpcUrl) });
  const chain = createForkClient(forkRpcUrl);
  const wallet = createWalletClient({ account: privateKeyToAccount(KEEPER_KEY), chain: monad, transport: http(forkRpcUrl) });
  const swap = createKyber({ baseUrl: KYBER_MONAD_URL, clientId: "levra" });
  const ctx = { db, logger: pino({ level: "silent" }), signal: new AbortController().signal };
  const long = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "long")!;
  const short = deployment.markets.find((m) => m.symbol === "QQQ" && m.side === "short")!;
  const protectedLong = randomAddress();
  const protectedShort = randomAddress();
  const unprotected = randomAddress();

  const lensPosition = async (user: Address, marketId: Hex) =>
    (await client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getPositions", args: [user] })).find((p) => p.marketId === marketId)!;
  const lensMarket = async (marketId: Hex) =>
    (await client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getMarkets" })).find((m) => m.marketId === marketId)!;
  const protect = (user: Address, marketId: Hex, enabled: boolean) =>
    as(chain, user, async () => {
      // Morpho refuses to set the same authorization twice.
      const authorized = await chain.readContract({ address: external.morpho, abi: morphoAbi, functionName: "isAuthorized", args: [user, deployment.router] });
      if (!authorized) await send(chain, user, external.morpho, morphoAbi, "setAuthorization", [deployment.router, true]);
      await send(chain, user, deployment.router, marginRouterAbi, "setProtection", [marketId, enabled]);
    });

  let snapshot: Hex;
  beforeAll(async () => {
    snapshot = await chain.snapshot();
    await runMigrations(dbUrl ?? "");
    await db.delete(routerEvents).where(eq(routerEvents.name, "ProtectionSet"));
    await db.delete(syncCursors).where(eq(syncCursors.name, ROUTER_CURSOR));

    // Between the soft limit and the hard limit: blocked from opening more, not yet liquidatable.
    const [lm, sm] = await Promise.all([lensMarket(long.marketId), lensMarket(short.marketId)]);
    const aimLong = (lm.currentSoftLtv + lm.lltv) / 2n;
    const aimShort = (sm.currentSoftLtv + sm.lltv) / 2n;
    const stockValue = mulDiv(lm.priceE8, 10n ** 6n, 10n ** 8n);
    await openOnMorpho(chain, long.marketId, protectedLong, parseUnits("1", 18), mulDiv(stockValue, aimLong, WAD));
    await openOnMorpho(chain, long.marketId, unprotected, parseUnits("1", 18), mulDiv(stockValue, aimLong, WAD));
    const shortCollateral = parseUnits("1000", 6);
    await openOnMorpho(chain, short.marketId, protectedShort, shortCollateral, stockForUsd(mulDiv(shortCollateral, aimShort, WAD), sm.priceE8, tokens.USDC.decimals, 18));

    await protect(protectedLong, long.marketId, true);
    await protect(protectedShort, short.marketId, true);
    // Switched on and off again: the latest event says off.
    await protect(unprotected, long.marketId, true);
    await protect(unprotected, long.marketId, false);
    await syncStream(db, rpcSource(client), deployment, routerStream(deployment));
  }, 300_000);
  afterAll(async () => {
    await chain.revert({ id: snapshot });
    await close();
  });

  const job = (closeIn: number) =>
    createProtector({ client, wallet, deployment, swap, nextClose: async (_db, now) => now + closeIn });

  it("does nothing outside the last 30 minutes before the close", { timeout: 60_000 }, async () => {
    const before = await lensPosition(protectedLong, long.marketId);
    expect(await job(3_600).run(ctx)).toMatchObject({ active: false });
    expect((await lensPosition(protectedLong, long.marketId)).ltv).toBe(before.ltv);
  });

  it("reduces protected positions above the limit to the target and leaves the others alone", { timeout: 300_000 }, async () => {
    const [longBefore, shortBefore, otherBefore] = await Promise.all([
      lensPosition(protectedLong, long.marketId),
      lensPosition(protectedShort, short.marketId),
      lensPosition(unprotected, long.marketId),
    ]);
    expect(longBefore.ltv > longBefore.softLtv && shortBefore.ltv > shortBefore.softLtv && otherBefore.ltv > otherBefore.softLtv).toBe(true);

    const result = (await job(600).run(ctx)) as { active: boolean; actions: { user: string; tx?: string }[] };
    expect(result.active).toBe(true);
    expect(result.actions.filter((a) => a.tx).map((a) => a.user).sort()).toEqual([protectedLong, protectedShort].sort());

    for (const [user, marketId] of [
      [protectedLong, long.marketId],
      [protectedShort, short.marketId],
    ] as const) {
      const after = await lensPosition(user, marketId);
      const target = after.softLtv - TARGET_BELOW_SOFT_WAD;
      expect(after.ltv <= target).toBe(true);
      // Reduced to the target, not far past it: within 2 points.
      expect(after.ltv > target - (2n * WAD) / 100n).toBe(true);
    }
    const other = await lensPosition(unprotected, long.marketId);
    expect([other.collateral, other.debt >= otherBefore.debt]).toEqual([otherBefore.collateral, true]);

    // The router keeps nothing.
    for (const token of [tokens.USDC.address, tokens.aQQQ.address]) {
      expect(await chain.readContract({ address: token, abi: [{ type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }], functionName: "balanceOf", args: [deployment.router] })).toBe(0n);
    }
  });
});
