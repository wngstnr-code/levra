import { createDb, keeperHeartbeats, monitorState, runMigrations } from "@levra/db";
import { REGULAR_SCHEDULE } from "@levra/shared/calendar";
import { eq, not, like } from "drizzle-orm";
import pino from "pino";
import { createPublicClient, http } from "viem";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forkDeployment, forkRpcUrl, onFork, randomAddress } from "../../api/test/fork-helpers";
import { createMonitor } from "../src/monitor/job";

const dbUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!onFork || !dbUrl)("team monitor on the fork (BE-50)", () => {
  const deployment = forkDeployment();
  const { db, close } = createDb(dbUrl ?? "postgres://unused", { max: 2 });
  const client = createPublicClient({ chain: monad, transport: http(forkRpcUrl) });
  const ctx = { db, logger: pino({ level: "silent" }), signal: new AbortController().signal };
  const team: string[] = [];
  const poorWallet = randomAddress();

  beforeAll(async () => {
    await runMigrations(dbUrl ?? "");
    await db.delete(monitorState).where(not(like(monitorState.key, "t-%")));
    // A keeper that stopped beating ten minutes ago.
    await db
      .insert(keeperHeartbeats)
      .values({ name: "transfers", lastBeatAt: new Date(Date.now() - 600_000), lastError: null })
      .onConflictDoUpdate({ target: keeperHeartbeats.name, set: { lastBeatAt: new Date(Date.now() - 600_000), lastError: null } });
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
    });
    const result = (await monitor.run(ctx)) as { oracleLimits: Record<string, { limitSeconds: number; learning: boolean }>; firing: string[] };

    expect(Object.keys(result.oracleLimits).sort()).toEqual([...new Set(deployment.markets.map((m) => m.symbol))].sort());
    expect(Object.values(result.oracleLimits).every((l) => l.limitSeconds > 0)).toBe(true);
    expect(result.firing).toEqual(expect.arrayContaining(["heartbeat:transfers", "balance:test keeper"]));
    expect(team.some((t) => t.startsWith("[Levra] ALERT: Keeper transfers has not beaten"))).toBe(true);
    expect(team.some((t) => t.includes(`test keeper wallet ${poorWallet} has 0.000 MON`))).toBe(true);
    expect(team.some((t) => t.includes("CHANGE"))).toBe(false);

    const values = await db.select().from(monitorState).where(like(monitorState.key, "max-oracle-age:%"));
    expect(values).toHaveLength(deployment.markets.length);

    // The same state on the next run sends nothing new.
    team.length = 0;
    await monitor.run(ctx);
    expect(team).toEqual([]);
  });
});
