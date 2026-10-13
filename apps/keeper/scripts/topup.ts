import { createPublicClient, createWalletClient, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { TOP_UP, mon, planTopUps } from "./roles";

/**
 * Tops up keeper wallets with MON from a funding wallet, within the limits in `TOP_UP` (BE-55). Run by a person, not by
 * the hosted keeper, so the funding key never sits on a server. The funding key is read from stdin, never from an
 * argument or a file in the repo.
 *
 *   echo <funding key> | tsx scripts/topup.ts "oracle age poster=0x..." "liquidator=0x..." [--confirm]
 *
 * Without --confirm it only prints the plan. Needs MONAD_RPC_URL.
 */

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const wallets = args
    .filter((a) => !a.startsWith("--"))
    .map((a) => {
      const at = a.lastIndexOf("=");
      const role = a.slice(0, at);
      const address = a.slice(at + 1);
      if (at <= 0 || !isAddress(address, { strict: false })) throw new Error(`Expected "role=0xaddress", got "${a}"`);
      return { role, address: getAddress(address) };
    });
  if (wallets.length === 0) throw new Error('Name the wallets as "role=0xaddress"');
  const rpc = process.env.MONAD_RPC_URL;
  if (!rpc) throw new Error("MONAD_RPC_URL is not set");

  const client = createPublicClient({ chain: monad, transport: http(rpc) });
  const balances = await Promise.all(wallets.map(async (w) => ({ ...w, balanceWei: await client.getBalance({ address: w.address }) })));
  const plan = planTopUps(balances);
  for (const p of plan) console.log(`${p.role} ${p.address}: has ${mon(p.balanceWei)}, send ${mon(p.sendWei)}`);
  console.log(`Limits: target ${mon(TOP_UP.targetWei)}, at most ${mon(TOP_UP.maxPerWalletWei)} per wallet and ${mon(TOP_UP.maxTotalWei)} per run.`);
  if (!confirm) return console.log("Dry run. Pipe the funding key into stdin and add --confirm to send.");

  const key = await readStdin();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("stdin did not hold a private key");
  const funder = privateKeyToAccount(key as `0x${string}`);
  const wallet = createWalletClient({ account: funder, chain: monad, transport: http(rpc) });
  for (const p of plan.filter((x) => x.sendWei > 0n)) {
    const hash = await wallet.sendTransaction({ to: p.address, value: p.sendWei });
    const receipt = await client.waitForTransactionReceipt({ hash });
    console.log(`${p.role}: sent ${mon(p.sendWei)} in ${hash} (${receipt.status})`);
  }
}

await main();
