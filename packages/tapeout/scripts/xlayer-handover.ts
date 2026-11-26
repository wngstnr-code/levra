import { readFileSync } from "node:fs";
import { xlayerTapeout } from "@levra/shared/addresses";
import { createPublicClient, createWalletClient, formatEther, getAddress, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import { circuitsAbi } from "../src/chain";
import { handOverCircuits } from "../src/handover";

/**
 * Hands the risk circuits from the TapeOut key to the team Safe (BE-84 known issue). The key keeps the clock circuit,
 * which TapeSend sends from. The key is read from a file into memory, never printed.
 *
 *   XLAYER_RPC_URL=https://rpc.xlayer.tech tsx scripts/xlayer-handover.ts --key-file <file> --to <safe> [--confirm]
 *
 * Without --confirm it prints the owners and the plan and sends nothing.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function main() {
  const rpc = process.env.XLAYER_RPC_URL;
  const keyFile = arg("--key-file");
  const to = arg("--to");
  if (!rpc) throw new Error("Set XLAYER_RPC_URL");
  if (!keyFile) throw new Error("Name the key with --key-file <file>");
  if (!to || !isAddress(to)) throw new Error("Name the team Safe with --to <address>");
  const key = readFileSync(keyFile, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${keyFile} does not hold a 0x-prefixed 32-byte private key`);
  const account = privateKeyToAccount(key as Hex);

  const transport = http(rpc, { timeout: 120_000, retryCount: 2 });
  const client = createPublicClient({ chain: xLayer, transport });
  const wallet = createWalletClient({ account, chain: xLayer, transport });
  const { processor, circuits } = xlayerTapeout;
  const risk = [BigInt(circuits.risk77), BigInt(circuits.risk62_5)];
  const keep = [BigInt(circuits.wallStreetClock)];

  console.log(`Signer ${account.address}, ${formatEther(await client.getBalance({ address: account.address }))} OKB. Safe ${getAddress(to)}.`);
  for (const id of [...keep, ...risk]) {
    const owner = await client.readContract({ address: processor, abi: circuitsAbi, functionName: "ownerOf", args: [id] });
    console.log(`circuit ${id}: held by ${owner}${keep.includes(id) ? " (stays: TapeSend sends from it)" : " (to the Safe)"}`);
  }
  if (!process.argv.includes("--confirm")) {
    console.log("Plan only. Add --confirm to send. Stop keeper-xlayer first if it runs with this key (one sender per key).");
    return;
  }
  for (const h of await handOverCircuits({ client, wallet }, processor, risk, to as `0x${string}`, keep)) {
    console.log(h.hash ? `circuit ${h.id}: moved, ${h.hash}` : `circuit ${h.id}: already with the Safe`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
