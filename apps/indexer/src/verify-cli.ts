import { createDb } from "@levra/db";
import { readDeployment } from "@levra/shared/deployments/node";
import { createPublicClient, http, type PublicClient } from "viem";
import { base, monad, xLayer } from "viem/chains";
import { loadEnv } from "./env";
import { rpcSource } from "./sources/rpc";
import { morphoStream, routerStream, vaultStream, type Stream } from "./sync";
import { checkPositions, checkStream, pacedSource, traction } from "./verify";

/**
 * Proves the indexed copy is complete (BE-91), with the indexer's own settings. Reads the chain again through the RPC
 * endpoint, not HyperSync, so the check does not share a source with the copy it checks. Exits 1 on any difference.
 * Usage: pnpm --filter @levra/indexer verify:data
 */
const viemChains = { 143: monad, 8453: base, 196: xLayer } as const;
const env = loadEnv();
const deployment = readDeployment(env.DEPLOYMENT_FILE);
if (deployment.chainId !== env.CHAIN_ID) throw new Error(`DEPLOYMENT_FILE is for chain ${deployment.chainId}, but CHAIN_ID is ${env.CHAIN_ID}`);
const client = createPublicClient({ chain: viemChains[env.CHAIN_ID], transport: http(env.rpcUrl, { retryCount: 5, timeout: 30_000 }) }) as PublicClient;
const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
/** Pause between log queries in ms. X Layer's public endpoint, shared with the running indexer, gets 500 by default. */
const pauseMs = Number(process.env.VERIFY_PAUSE_MS ?? (env.CHAIN_ID === 196 ? 500 : 0));
if (!Number.isInteger(pauseMs) || pauseMs < 0) throw new Error("VERIFY_PAUSE_MS must be a whole number of ms");

let failed = false;
try {
  console.log(`Chain ${deployment.chainId}, router ${deployment.router}, from block ${deployment.block}.\n`);

  const streams = [routerStream(deployment), morphoStream(deployment), vaultStream(deployment)].filter((s): s is Stream => s !== null);
  for (const stream of streams) {
    const r = await checkStream(db, pacedSource(rpcSource(client, BigInt(env.LOG_BLOCK_RANGE)), pauseMs), deployment, stream);
    if (!r) {
      console.log(`${stream.cursor}: not synced yet (no cursor). Start the indexer first.`);
      failed = true;
      continue;
    }
    // Read after the check: a running indexer moves its cursor while the check reads.
    const lag = (await client.getBlockNumber()) - r.upToBlock;
    const ok = r.missing.length === 0 && r.extra.length === 0;
    if (!ok) failed = true;
    console.log(`${stream.cursor}: ${ok ? "complete" : "DIFFERENT"}. ${r.onChain} on chain, ${r.inDb} stored, up to block ${r.upToBlock} (${lag} behind the head).`);
    for (const k of r.missing.slice(0, 20)) console.log(`  missing ${k}`);
    for (const k of r.extra.slice(0, 20)) console.log(`  extra ${k}`);
  }

  const p = await checkPositions(db, client, deployment);
  if (p.mismatches.length > 0) failed = true;
  console.log(`\nPositions rebuilt from Morpho events: ${p.checked} checked against Morpho (${p.open} open), ${p.mismatches.length} different.`);
  for (const m of p.mismatches.slice(0, 20)) {
    console.log(`  ${m.user} in ${m.marketId}: stored ${m.indexed.collateral} / ${m.indexed.borrowShares}, chain ${m.onChain.collateral} / ${m.onChain.borrowShares} (collateral / borrow shares)`);
  }

  const t = await traction(db, deployment.chainId);
  console.log(`\nTraction on chain ${deployment.chainId}: ${t.wallets} wallets opened a position or used the vault, first ${t.firstAt?.toISOString() ?? "-"}, last ${t.lastAt?.toISOString() ?? "-"}.`);
  console.log("| Event | Count | Wallets |\n|---|---|---|");
  for (const r of [...t.router, ...t.vault.map((v) => ({ ...v, name: `Vault ${v.name}` }))]) console.log(`| ${r.name} | ${r.events} | ${r.wallets} |`);
  console.log(failed ? "\nResult: DIFFERENT. Do not switch traffic to this database yet." : "\nResult: complete.");
} finally {
  await close();
}
process.exit(failed ? 1 : 0);
