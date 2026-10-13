import type { Db } from "@levra/db";
import { riskManagerAbi } from "@levra/shared/abis";
import { REGULAR_SCHEDULE, etToUnix, nextCloseAfter, scheduleFromStretches } from "@levra/shared/calendar";
import { readDeployment } from "@levra/shared/deployments/node";
import pino from "pino";
import { createPublicClient, createWalletClient, http, parseAbi, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCalendarPoster } from "../src/calendar/poster";

const rpcUrl = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545";
const deploymentFile = process.env.FORK_DEPLOYMENT_FILE;
const onFork = !!process.env.FORK_RPC_URL && !!deploymentFile;
/** Fourth Anvil test account. Deploy the fork with CALENDAR_POSTER set to its address. Never holds real funds. */
const POSTER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const OTHER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

describe.skipIf(!onFork)("calendar poster on the fork (BE-30)", () => {
  const deployment = onFork
    ? readDeployment(deploymentFile ?? "")
    : { chainId: 143, block: 0, router: zeroAddress, riskManager: zeroAddress, lens: zeroAddress, markets: [] };
  const client = createPublicClient({ chain: monad, transport: http(rpcUrl) });
  const walletOf = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: monad, transport: http(rpcUrl) });
  const ctx = { db: {} as Db, logger: pino({ level: "silent" }), signal: new AbortController().signal };
  const onChain = async () => Number(await client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "nextCloseAt" }));
  const chainNow = async () => Number((await client.getBlock({ blockTag: "latest" })).timestamp);

  /** Stands in for the oracle logger: starts with no weekend, and gets one in the middle of the test. */
  const stretches: { firstClosedAt: number; reopenedAt: number }[] = [];
  const job = createCalendarPoster({ client, wallet: walletOf(POSTER_KEY), deployment, schedule: async () => scheduleFromStretches(stretches) });

  let snapshot: Hex;
  beforeAll(async () => {
    const poster = await client.readContract({ address: deployment.riskManager, abi: parseAbi(["function calendarPoster() view returns (address)"]), functionName: "calendarPoster" });
    if (poster.toLowerCase() !== privateKeyToAccount(POSTER_KEY).address.toLowerCase()) {
      throw new Error(`Deploy the fork with CALENDAR_POSTER=${privateKeyToAccount(POSTER_KEY).address} (now ${poster})`);
    }
    snapshot = await client.request({ method: "evm_snapshot" as any, params: [] as any });
  });
  afterAll(async () => {
    await client.request({ method: "evm_revert" as any, params: [snapshot] as any });
  });

  it("posts the regular close while no weekend has been observed", { timeout: 60_000 }, async () => {
    const result = (await job.run(ctx)) as { action: string; schedule: { source: string } };
    expect(result).toMatchObject({ action: "post", schedule: { source: "regular" } });
    expect(await onChain()).toBe(nextCloseAfter(await chainNow(), REGULAR_SCHEDULE));
  });

  it("moves to the observed close once a weekend is in the data, with the same job", { timeout: 60_000 }, async () => {
    const regular = await onChain();
    // A Friday close at 20:00 ET (four hours after the regular close) and a Sunday 20:00 ET reopening.
    stretches.push({ firstClosedAt: etToUnix("2026-10-09", 20 * 3600), reopenedAt: etToUnix("2026-10-11", 20 * 3600) });
    const result = (await job.run(ctx)) as { action: string; schedule: { source: string } };
    expect(result).toMatchObject({ action: "post", schedule: { source: "observed" } });
    const observed = await onChain();
    expect(observed).toBe(nextCloseAfter(await chainNow(), scheduleFromStretches(stretches)));
    expect(observed - regular).toBe(4 * 3600);
    expect(((await job.run(ctx)) as { action: string }).action).toBe("skip");
  });

  it("refuses to run with a key that is not the poster", async () => {
    const other = createCalendarPoster({ client, wallet: walletOf(OTHER_KEY), deployment, schedule: async () => REGULAR_SCHEDULE });
    await expect(other.run(ctx)).rejects.toThrow(/not the calendar poster/);
  });
});
