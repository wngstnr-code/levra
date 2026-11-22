import { createDb, keeperHeartbeats, monitorState, runMigrations } from "@levra/db";
import { externalByChain, tokens } from "@levra/shared/addresses";
import { REGULAR_SCHEDULE } from "@levra/shared/calendar";
import { eq, not, like } from "drizzle-orm";
import pino from "pino";
import { createPublicClient, http, keccak256, parseAbi, toBytes, zeroHash } from "viem";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createForkClient, forkDeployment, forkRpcUrl, onFork, randomAddress } from "../../api/test/fork-helpers";
import { createMonitor } from "../src/monitor/job";

const dbUrl = process.env.TEST_DATABASE_URL;
const DEFAULT_ADMIN_ROLE = zeroHash;
/** Anchored's compliance contract, admin side, read from its bytecode and errors on 22 November 2026 (test only). */
const complianceAdminAbi = parseAbi([
  "function getRoleMember(bytes32 role, uint256 index) view returns (address)",
  "function grantRole(bytes32 role, address account)",
  "function addToDenylist(address[] accounts)",
  "function removeFromDenylist(address[] accounts)",
]);
/** Circle's FiatToken blacklister side (test only). */
const usdcBlacklisterAbi = parseAbi(["function blacklister() view returns (address)", "function blacklist(address account)", "function unBlacklist(address account)"]);

describe.skipIf(!onFork || !dbUrl)("team monitor on the fork (BE-50)", () => {
  const deployment = forkDeployment();
  const { db, close } = createDb(dbUrl ?? "postgres://unused", { max: 2 });
  const client = createPublicClient({ chain: monad, transport: http(forkRpcUrl) });
  const ctx = { db, chainId: 143 as const, logger: pino({ level: "silent" }), signal: new AbortController().signal };
  const team: string[] = [];
  const poorWallet = randomAddress();

  beforeAll(async () => {
    await runMigrations(dbUrl ?? "");
    await db.delete(monitorState).where(not(like(monitorState.key, "t-%")));
    // A keeper that stopped beating ten minutes ago.
    await db
      .insert(keeperHeartbeats)
      .values({ chainId: 143, name: "transfers", lastBeatAt: new Date(Date.now() - 600_000), lastError: null })
      .onConflictDoUpdate({ target: [keeperHeartbeats.chainId, keeperHeartbeats.name], set: { lastBeatAt: new Date(Date.now() - 600_000), lastError: null } });
  });
  afterAll(async () => {
    await db.delete(keeperHeartbeats).where(eq(keeperHeartbeats.name, "transfers"));
    await db.delete(monitorState).where(not(like(monitorState.key, "t-%")));
    await close();
  });

  it("reads every market from the chain, reports the late keeper and the empty wallet, and records the first risk values quietly", { timeout: 120_000 }, async () => {
    const monitor = createMonitor({
      client,
      deployment,
      channels: [async (text) => void team.push(text)],
      wallets: [{ role: "test keeper", address: poorWallet }],
      schedule: async () => REGULAR_SCHEDULE,
      bars: async () => [],
    });
    const result = (await monitor.run(ctx)) as { oracleLimits: Record<string, { limitSeconds: number; learning: boolean }>; firing: string[] };

    expect(Object.keys(result.oracleLimits).sort()).toEqual([...new Set(deployment.markets.map((m) => m.symbol))].sort());
    expect(Object.values(result.oracleLimits).every((l) => l.limitSeconds > 0)).toBe(true);
    expect(result.firing).toEqual(expect.arrayContaining(["heartbeat:transfers", "balance:test keeper"]));
    expect(team.some((t) => t.startsWith("[Levra Monad] ALERT: Keeper transfers has not beaten"))).toBe(true);
    expect(team.some((t) => t.includes(`test keeper wallet ${poorWallet} has 0 MON`))).toBe(true);
    expect(team.some((t) => t.includes("CHANGE"))).toBe(false);

    const values = await db.select().from(monitorState).where(like(monitorState.key, "max-oracle-age:%"));
    expect(values).toHaveLength(deployment.markets.length);

    // The same state on the next run sends nothing new.
    team.length = 0;
    await monitor.run(ctx);
    expect(team).toEqual([]);
  });

  it("alerts the team when Anchored's compliance denylists Morpho (BE-75), and resolves when it is lifted", { timeout: 120_000 }, async () => {
    const chain = createForkClient(forkRpcUrl);
    const compliance = externalByChain[143].anchoredCompliance;
    const morpho = externalByChain[143].morpho;
    const monitor = createMonitor({ client, deployment, channels: [async (text) => void team.push(text)], wallets: [], schedule: async () => REGULAR_SCHEDULE, bars: async () => [] });
    const before = (await monitor.run(ctx)) as { firing: string[] };
    expect(before.firing.filter((k) => k.startsWith("gate:"))).toEqual([]);

    // Test only: the compliance admin gives itself the adder and remover roles, as only a fork lets us.
    const admin = await chain.readContract({ address: compliance, abi: complianceAdminAbi, functionName: "getRoleMember", args: [DEFAULT_ADMIN_ROLE, 0n] });
    const write = async (functionName: "grantRole" | "addToDenylist" | "removeFromDenylist", args: readonly unknown[]) =>
      as(chain, admin, async () => {
        const hash = await chain.writeContract({ account: admin, chain: monad, address: compliance, abi: complianceAdminAbi, functionName, args } as never);
        expect((await chain.waitForTransactionReceipt({ hash })).status).toBe("success");
      });
    const snapshot = await chain.snapshot();
    try {
      await write("grantRole", [keccak256(toBytes("DENYLIST_ADDER_ROLE")), admin]);
      await write("grantRole", [keccak256(toBytes("DENYLIST_REMOVER_ROLE")), admin]);
      await write("addToDenylist", [[morpho]]);

      team.length = 0;
      const blocked = (await monitor.run(ctx)) as { firing: string[] };
      expect(blocked.firing).toContain("gate:anchored-denylist:Morpho");
      expect(team.some((t) => t.includes("ALERT") && t.includes(`Anchored compliance denylists Morpho (${morpho})`))).toBe(true);

      await write("removeFromDenylist", [[morpho]]);
      team.length = 0;
      const lifted = (await monitor.run(ctx)) as { firing: string[] };
      expect(lifted.firing).not.toContain("gate:anchored-denylist:Morpho");
      expect(team.some((t) => t.includes("RESOLVED") && t.includes("Anchored compliance denylists Morpho"))).toBe(true);
    } finally {
      await chain.revert({ id: snapshot });
    }
  });

  it("alerts the team when Circle blacklists our router for USDC (BE-75)", { timeout: 120_000 }, async () => {
    const chain = createForkClient(forkRpcUrl);
    const usdc = tokens.USDC.address;
    const monitor = createMonitor({ client, deployment, channels: [async (text) => void team.push(text)], wallets: [], schedule: async () => REGULAR_SCHEDULE, bars: async () => [] });
    await monitor.run(ctx);

    const blacklister = await chain.readContract({ address: usdc, abi: usdcBlacklisterAbi, functionName: "blacklister" });
    const write = async (functionName: "blacklist" | "unBlacklist") =>
      as(chain, blacklister, async () => {
        const hash = await chain.writeContract({ account: blacklister, chain: monad, address: usdc, abi: usdcBlacklisterAbi, functionName, args: [deployment.router] });
        expect((await chain.waitForTransactionReceipt({ hash })).status).toBe("success");
      });
    const snapshot = await chain.snapshot();
    try {
      await write("blacklist");
      team.length = 0;
      const blocked = (await monitor.run(ctx)) as { firing: string[] };
      expect(blocked.firing).toContain("gate:usdc-blacklist:router");
      expect(team.some((t) => t.includes("ALERT") && t.includes(`Circle blacklists router (${deployment.router}) for USDC`))).toBe(true);

      await write("unBlacklist");
      team.length = 0;
      const lifted = (await monitor.run(ctx)) as { firing: string[] };
      expect(lifted.firing).not.toContain("gate:usdc-blacklist:router");
      expect(team.some((t) => t.includes("RESOLVED"))).toBe(true);
    } finally {
      await chain.revert({ id: snapshot });
    }
  });
});
