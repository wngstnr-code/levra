import { createPublicClient, createWalletClient, getAddress, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { railwayVariables } from "./move-variables";
import { ROLES, isRoleName, mon, type RoleName } from "./roles";

/**
 * Moves all MON from old keeper wallets to the new ones (BE-91), after leaving Railway or after a key rotation. Each
 * old key is read from the Railway CLI into memory only: never printed, written to a file or put on a command line.
 *
 *   MONAD_RPC_URL=... tsx scripts/sweep.ts --from keeper ORACLE_AGE_POSTER_KEY=0x<new address> ... [--confirm]
 *
 * Without --confirm it only prints the plan. Monad keeps a 10 MON reserve per wallet, but an undelegated wallet with
 * nothing else in flight may go below it (an emptying transaction), so everything moves except the fee.
 */

export const TRANSFER_GAS = 21_000n;

export type SweepArgs = { from: string; moves: { role: RoleName; to: Address }[]; confirm: boolean };

export function parseSweepArgs(args: string[]): SweepArgs {
  const at = args.indexOf("--from");
  const from = at >= 0 ? args[at + 1] : undefined;
  if (!from || from.startsWith("--")) throw new Error("Name the Railway service with --from");
  const moves = args
    .filter((a, i) => !a.startsWith("--") && i !== at + 1)
    .map((a) => {
      const eq = a.indexOf("=");
      const role = a.slice(0, eq);
      const to = a.slice(eq + 1);
      if (eq <= 0 || !isRoleName(role) || !isAddress(to, { strict: false })) {
        throw new Error(`Expected ROLE=0x<new address> with a role of ${Object.keys(ROLES).join(", ")}, got "${a}"`);
      }
      return { role, to: getAddress(to) };
    });
  if (moves.length === 0) throw new Error("Name one or more ROLE=0x<new address> pairs");
  if (new Set(moves.map((m) => m.role)).size !== moves.length) throw new Error("A role is named twice");
  if (new Set(moves.map((m) => m.to)).size !== moves.length) throw new Error("Two roles go to the same new address");
  return { from, moves, confirm: args.includes("--confirm") };
}

/** Monad charges the gas limit, not the gas used, so the fee is known before the send and the rest can all move. */
export function sweepAmount(balanceWei: bigint, maxFeePerGas: bigint, gas = TRANSFER_GAS): bigint {
  const fee = gas * maxFeePerGas;
  return balanceWei > fee ? balanceWei - fee : 0n;
}

async function main() {
  const { from, moves, confirm } = parseSweepArgs(process.argv.slice(2));
  const rpc = process.env.MONAD_RPC_URL;
  if (!rpc) throw new Error("MONAD_RPC_URL is not set");
  const client = createPublicClient({ chain: monad, transport: http(rpc) });
  const variables = await railwayVariables(from);
  const fees = await client.estimateFeesPerGas();

  const plan = [];
  for (const { role, to } of moves) {
    const key = variables[role]?.trim();
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${role} is not a private key on Railway service ${from}`);
    const account = privateKeyToAccount(key as Hex);
    if (account.address === to) throw new Error(`${role}: the new address is the old one`);
    const [balance, latest, pending, code, toCode] = await Promise.all([
      client.getBalance({ address: account.address }),
      client.getTransactionCount({ address: account.address, blockTag: "latest" }),
      client.getTransactionCount({ address: account.address, blockTag: "pending" }),
      client.getCode({ address: account.address }),
      client.getCode({ address: to }),
    ]);
    // A delegated wallet keeps the 10 MON reserve, and a transaction in flight blocks the emptying exception.
    if (code && code !== "0x") throw new Error(`${role}: ${account.address} is delegated (EIP-7702), so it cannot go below 10 MON`);
    if (latest !== pending) throw new Error(`${role}: ${account.address} has a transaction in flight; stop the old keeper first`);
    if (toCode && toCode !== "0x") throw new Error(`${role}: ${to} is a contract, expected a new keeper wallet`);
    const sendWei = sweepAmount(balance, fees.maxFeePerGas);
    console.log(`${ROLES[role].label}: ${account.address} has ${mon(balance)}, send ${mon(sendWei)} to ${to}`);
    plan.push({ role, account, to, sendWei, nonce: latest });
  }
  console.log(`Fee per transfer at most ${mon(TRANSFER_GAS * fees.maxFeePerGas)}.`);
  if (!confirm) return console.log("\nDry run. Add --confirm to send.");

  for (const p of plan.filter((x) => x.sendWei > 0n)) {
    const wallet = createWalletClient({ account: p.account, chain: monad, transport: http(rpc) });
    const hash = await wallet.sendTransaction({
      to: p.to,
      value: p.sendWei,
      gas: TRANSFER_GAS,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      nonce: p.nonce,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    console.log(`${ROLES[p.role].label}: sent ${mon(p.sendWei)} in ${hash} (${receipt.status})`);
    if (receipt.status !== "success") throw new Error(`Stopped after ${p.role} failed; the others were not sent`);
  }
}

if (process.argv[1]?.endsWith("sweep.ts")) await main();
