import type { Db } from "@levra/db";
import { riskManagerAbi } from "@levra/shared/abis";
import { readDeployment } from "@levra/shared/deployments/node";
import pino from "pino";
import { createPublicClient, createWalletClient, http, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOracleAgePoster, type ProposalSource } from "../src/oracle/age-poster";

const rpcUrl = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545";
const deploymentFile = process.env.FORK_DEPLOYMENT_FILE;
const onFork = !!process.env.FORK_RPC_URL && !!deploymentFile;
/** Second Anvil test account. Deploy the fork with ORACLE_AGE_POSTER set to its address. Never holds real funds. */
const POSTER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const OTHER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

describe.skipIf(!onFork)("oracle age poster on the fork (BE-17)", () => {
  const deployment = onFork
    ? readDeployment(deploymentFile ?? "")
    : { chainId: 143, block: 0, router: zeroAddress, riskManager: zeroAddress, lens: zeroAddress, markets: [] };
  const client = createPublicClient({ chain: monad, transport: http(rpcUrl) });
  const walletOf = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: monad, transport: http(rpcUrl) });
  const ctx = { db: {} as Db, logger: pino({ level: "silent" }), signal: new AbortController().signal };
  const fixed = (values: Record<string, number | null>): ProposalSource => async () =>
    new Map(Object.entries(values).map(([s, v]) => [s, v === null ? { value: null, reason: "less than 7 days of data" } : { value: v, reason: null }]));
  const maxAge = async (symbol: string, side: string) => {
    const m = deployment.markets.find((x) => x.symbol === symbol && x.side === side)!;
    return (await client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [m.marketId] })).maxOracleAge;
  };

  let snapshot: Hex;
  beforeAll(async () => {
    const poster = await client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "oracleAgePoster" });
    if (poster.toLowerCase() !== privateKeyToAccount(POSTER_KEY).address.toLowerCase()) {
      throw new Error(`Deploy the fork with ORACLE_AGE_POSTER=${privateKeyToAccount(POSTER_KEY).address} (now ${poster})`);
    }
    snapshot = await client.request({ method: "evm_snapshot" as any, params: [] as any });
  });
  afterAll(async () => {
    await client.request({ method: "evm_revert" as any, params: [snapshot] as any });
  });

  it("posts the data-based value for every market of a stock, inside the bounds", { timeout: 60_000 }, async () => {
    const job = createOracleAgePoster({ client, wallet: walletOf(POSTER_KEY), deployment, proposals: fixed({ QQQ: 2_700, HOOD: 1_800, BIL: 50_000 }) });
    const result = (await job.run(ctx)) as { markets: { symbol: string; action: string; value?: number }[] };

    expect(result.markets.filter((m) => m.action === "post")).toHaveLength(5);
    expect(await maxAge("QQQ", "long")).toBe(2_700);
    expect(await maxAge("QQQ", "short")).toBe(2_700);
    expect(await maxAge("HOOD", "long")).toBe(1_800);
    const bil = result.markets.find((m) => m.symbol === "BIL")!;
    const [, cap] = await client.readContract({
      address: deployment.riskManager,
      abi: riskManagerAbi,
      functionName: "oracleAgeBounds",
      args: [deployment.markets.find((m) => m.symbol === "BIL")!.marketId],
    });
    expect(bil).toMatchObject({ action: "post", value: cap });
    expect(await maxAge("BIL", "long")).toBe(cap);
  });

  it("leaves the chain alone when the change is small or the data is not enough", { timeout: 60_000 }, async () => {
    const job = createOracleAgePoster({ client, wallet: walletOf(POSTER_KEY), deployment, proposals: fixed({ QQQ: 2_800, HOOD: null, BIL: null }) });
    const result = (await job.run(ctx)) as { markets: { action: string }[] };
    expect(result.markets.every((m) => m.action === "skip")).toBe(true);
    expect(await maxAge("QQQ", "long")).toBe(2_700);
  });

  it("refuses to run with a key that is not the poster", async () => {
    const job = createOracleAgePoster({ client, wallet: walletOf(OTHER_KEY), deployment, proposals: fixed({ QQQ: 3_000 }) });
    await expect(job.run(ctx)).rejects.toThrow(/not the oracle age poster/);
  });
});
