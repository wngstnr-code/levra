import { getAddress, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { circuitsAbi, type TapeOutClients } from "./chain";

export type Handover = { id: bigint; hash: Hex | null };

/** What a handover would do, checked before anything is sent. */
export type HandoverPlan = {
  to: Address;
  /** The receiver's Safe threshold: at least 2, so no single key, the hot one included, can move a circuit on. */
  threshold: bigint;
  circuits: { id: bigint; owner: Address; move: boolean }[];
};

const safeAbi = parseAbi(["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"]);

/**
 * Checks a handover of circuit NFTs from `from` to `to` (BE-84 known issue) without sending: the receiver is not the
 * signer, answers as a Safe with a threshold of at least 2 (a mistyped contract would lock the circuits for good, since
 * `transferFrom` skips the receiver hook), no id is in `keep` (the clock circuit, which TapeSend needs), and each
 * circuit is held by the signer or already by the receiver.
 */
export async function planHandover(client: PublicClient, circuits: Address, from: Address, ids: bigint[], to: Address, keep: bigint[]): Promise<HandoverPlan> {
  const signer = getAddress(from);
  const dest = getAddress(to);
  if (dest === signer) throw new Error("the receiver is the signer itself");
  const kept = ids.filter((id) => keep.includes(id));
  if (kept.length > 0) throw new Error(`circuit ${kept.join(", ")} must stay with the signer`);
  if ((await client.getCode({ address: dest })) === undefined) throw new Error(`${dest} has no code; hand the circuits to the team Safe, not to a plain address`);

  let threshold: bigint;
  let safeOwners: readonly Address[];
  try {
    [threshold, safeOwners] = await Promise.all([
      client.readContract({ address: dest, abi: safeAbi, functionName: "getThreshold" }),
      client.readContract({ address: dest, abi: safeAbi, functionName: "getOwners" }),
    ]);
  } catch {
    throw new Error(`${dest} does not answer as a Safe; hand the circuits to the team Safe`);
  }
  if (threshold < 2n || BigInt(safeOwners.length) < threshold) throw new Error(`${dest} is a Safe with threshold ${threshold} of ${safeOwners.length}; it needs at least 2 signers`);

  const owners = await Promise.all(ids.map((id) => client.readContract({ address: circuits, abi: circuitsAbi, functionName: "ownerOf", args: [id] })));
  const planned = ids.map((id, i) => {
    const owner = getAddress(owners[i]!);
    if (owner !== signer && owner !== dest) throw new Error(`circuit ${id} is held by ${owner}, not by the signer ${signer}`);
    return { id, owner, move: owner === signer };
  });
  return { to: dest, threshold, circuits: planned };
}

/**
 * Moves circuit NFTs from the signer to the team Safe after `planHandover` passes: the hot key on the VPS keeps only the
 * clock circuit, and the risk circuits go to the Safe. `eval` is a public view, so the API and the keeper read a circuit
 * whoever holds it. A circuit already at `to` is skipped.
 */
export async function handOverCircuits({ client, wallet }: TapeOutClients, circuits: Address, ids: bigint[], to: Address, keep: bigint[]): Promise<Handover[]> {
  const from = getAddress(wallet.account.address);
  const plan = await planHandover(client, circuits, from, ids, to, keep);

  const done: Handover[] = [];
  for (const { id, move } of plan.circuits) {
    if (!move) {
      done.push({ id, hash: null });
      continue;
    }
    const hash = await wallet.writeContract({ address: circuits, abi: circuitsAbi, functionName: "transferFrom", args: [from, plan.to, id], chain: wallet.chain });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    const owner = await client.readContract({ address: circuits, abi: circuitsAbi, functionName: "ownerOf", args: [id] });
    if (getAddress(owner) !== plan.to) throw new Error(`circuit ${id} is still held by ${owner} after ${hash}`);
    done.push({ id, hash });
  }
  return done;
}
