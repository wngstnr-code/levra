import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { xlayerExternal } from "@levra/shared/addresses";
import { xlayerDeployment } from "@levra/shared/deployments/xlayer";
import { createPublicClient, createWalletClient, formatEther, formatUnits, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import { LEVRA_PROCESSOR as PROCESSOR, planCircuits, quoteRun, runTapeOut, type RunState } from "../src/run";

/**
 * The TapeOut run on X Layer mainnet (BE-82, D-113). The key is read from a file into memory, never printed.
 *
 *   XLAYER_RPC_URL=https://rpc.xlayer.tech tsx scripts/xlayer-run.ts --key-file <file> [--state <file>] [--confirm]
 *
 * Without --confirm it prints the plan and the cost and sends nothing. The state file holds only public data
 * (addresses, ids, hashes); keep it, since a second run reads it to skip what is done.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function readKey(file: string): Hex {
  const key = readFileSync(file, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${file} does not hold a 0x-prefixed 32-byte private key`);
  return key as Hex;
}

async function main() {
  const rpc = process.env.XLAYER_RPC_URL;
  const keyFile = arg("--key-file");
  if (!rpc) throw new Error("Set XLAYER_RPC_URL");
  if (!keyFile) throw new Error("Name the key with --key-file <file>");
  const account = privateKeyToAccount(readKey(keyFile));
  const statePath = arg("--state") ?? `tapeout-xlayer-${account.address.toLowerCase()}.json`;

  const transport = http(rpc, { timeout: 120_000, retryCount: 2 });
  const client = createPublicClient({ chain: xLayer, transport });
  const wallet = createWalletClient({ account, chain: xLayer, transport });
  const contracts = { factory: xlayerExternal.tapeoutFactory, opener: xlayerExternal.tapeoutOpener, hub: xlayerExternal.tapesendHub };

  const state: RunState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { chainId: xLayer.id, signer: account.address, circuits: {} };
  const save = (s: RunState) => {
    writeFileSync(`${statePath}.tmp`, `${JSON.stringify(s, null, 2)}\n`);
    renameSync(`${statePath}.tmp`, statePath);
  };

  const plans = await planCircuits(client as never, xlayerDeployment);
  const quote = await quoteRun(client as never, { contracts, processor: PROCESSOR }, plans, state);
  console.log(`signer ${quote.signer}, state ${statePath}`);
  for (const p of plans) console.log(`  ${state.circuits[p.key] ? "done" : "todo"}  ${p.label}: ${p.circuit.gates.length} NAND`);
  console.log(`  ${quote.gates} NAND in all, transistor supply ${quote.supply}, mint price 0`);
  console.log(`  fees: processor ${formatUnits(quote.fees.deploy, 8)} BEM, mint ${formatUnits(quote.fees.protocol, 8)} BEM per call, tape out ${formatEther(quote.fees.tapeout)} OKB, container ${formatEther(quote.fees.open)} OKB, gas price ${quote.fees.gasPrice} wei`);
  console.log(`  BEM: needs ${formatUnits(quote.bem.need, 8)}, holds ${formatUnits(quote.bem.have, 8)}`);
  console.log(`  OKB: needs about ${formatEther(quote.okb.need)} (gas with a 50% margin), holds ${formatEther(quote.okb.have)}`);
  if (state.pending) console.log(`  last run stopped during "${state.pending.step}"`);

  const short = quote.bem.have < quote.bem.need || quote.okb.have < quote.okb.need;
  if (!process.argv.includes("--confirm")) {
    console.log(short ? "Not enough funds yet. Nothing sent." : "Plan only. Add --confirm to send.");
    return;
  }
  if (short) throw new Error("not enough BEM or OKB for the remaining steps");
  await runTapeOut({ client: client as never, wallet: wallet as never }, { contracts, deployment: xlayerDeployment, processor: PROCESSOR, save, log: console.log }, plans, state);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
