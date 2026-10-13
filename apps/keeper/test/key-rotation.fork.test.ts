import type { Db } from "@levra/db";
import { riskManagerAbi } from "@levra/shared/abis";
import { readDeployment } from "@levra/shared/deployments/node";
import pino from "pino";
import { createPublicClient, createWalletClient, http, parseAbi, zeroAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOracleAgePoster, type ProposalSource } from "../src/oracle/age-poster";

const rpcUrl = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545";
const deploymentFile = process.env.FORK_DEPLOYMENT_FILE;
const onFork = !!process.env.FORK_RPC_URL && !!deploymentFile;
/** Second Anvil test account, the oracle age poster of the fork deployment. Treated here as leaked. */
const LEAKED_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ownerAbi = parseAbi(["function owner() view returns (address)"]);

describe.skipIf(!onFork)("key rotation drill: the oracle age poster key leaked (BE-55)", () => {
  const deployment = onFork ? readDeployment(deploymentFile ?? "") : { chainId: 143, block: 0, router: zeroAddress, riskManager: zeroAddress, lens: zeroAddress, markets: [] };
  const client = createPublicClient({ chain: monad, transport: http(rpcUrl) });
  const ctx = { db: {} as Db, logger: pino({ level: "silent" }), signal: new AbortController().signal };
  const walletOf = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: monad, transport: http(rpcUrl) });
  const freshKey = generatePrivateKey();
  const market = deployment.markets[0];
  const posterFor = (key: Hex, value: number) =>
    createOracleAgePoster({ client, wallet: walletOf(key), deployment, proposals: (async () => new Map([[market!.symbol, { value, reason: null }]])) as ProposalSource });
  const maxAge = async () => (await client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [market!.marketId] })).maxOracleAge;

  let snapshot: Hex;
  beforeAll(async () => {
    snapshot = await client.request({ method: "evm_snapshot" as never, params: [] as never });
    const poster = await client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "oracleAgePoster" });
    if (poster.toLowerCase() !== privateKeyToAccount(LEAKED_KEY).address.toLowerCase()) throw new Error(`Deploy the fork with ORACLE_AGE_POSTER=${privateKeyToAccount(LEAKED_KEY).address}`);
    await client.request({ method: "anvil_setBalance" as never, params: [privateKeyToAccount(freshKey).address, "0x8AC7230489E80000"] as never });
  });
  afterAll(async () => {
    await client.request({ method: "evm_revert" as never, params: [snapshot] as never });
  });

  it("moves the role to a fresh key in one owner call; the leaked key can do nothing after it", { timeout: 120_000 }, async () => {
    const [, cap] = await client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "oracleAgeBounds", args: [market!.marketId] });
    const owner = await client.readContract({ address: deployment.riskManager, abi: ownerAbi, functionName: "owner" });
    const fresh = privateKeyToAccount(freshKey).address;

    // 1. The owner (the multisig after SC-55) points the role at the new address.
    await client.request({ method: "anvil_impersonateAccount" as never, params: [owner] as never });
    const ownerWallet = createWalletClient({ account: owner, chain: monad, transport: http(rpcUrl) });
    const hash = await ownerWallet.writeContract({ address: deployment.riskManager, abi: parseAbi(["function setOracleAgePoster(address)"]), functionName: "setOracleAgePoster", args: [fresh] });
    expect((await client.waitForTransactionReceipt({ hash })).status).toBe("success");
    await client.request({ method: "anvil_stopImpersonatingAccount" as never, params: [owner] as never });

    // 2. The leaked key is refused by the job before it sends anything, and by the contract if sent directly.
    await expect(posterFor(LEAKED_KEY, cap).run(ctx)).rejects.toThrow(/not the oracle age poster/);
    const direct = await client
      .simulateContract({ account: privateKeyToAccount(LEAKED_KEY), address: deployment.riskManager, abi: riskManagerAbi, functionName: "setMaxOracleAge", args: [market!.marketId, cap] })
      .then(() => "accepted")
      .catch(() => "refused");
    expect(direct).toBe("refused");

    // 3. The keeper restarted with the new key posts again.
    const result = (await posterFor(freshKey, cap).run(ctx)) as { markets: { action: string }[] };
    expect(result.markets.some((m) => m.action === "post")).toBe(true);
    expect(await maxAge()).toBe(cap);
  });
});
