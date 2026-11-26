import { getAddress, type Address, type Hex } from "viem";
import { circuitsAbi, type TapeOutClients } from "./chain";

export type Handover = { id: bigint; hash: Hex | null };

/**
 * Moves circuit NFTs from the signer to `to` (BE-84 known issue): the hot key on the VPS keeps only the clock circuit,
 * which TapeSend needs, and the risk circuits go to the team Safe. `eval` is a public view, so the API and the keeper
 * read a circuit whoever holds it. Uses `transferFrom`, so the receiver needs no ERC-721 hook. A circuit already at
 * `to` is skipped; one held by anyone else stops the run before anything is sent.
 */
export async function handOverCircuits({ client, wallet }: TapeOutClients, circuits: Address, ids: bigint[], to: Address, keep: bigint[]): Promise<Handover[]> {
  const from = getAddress(wallet.account.address);
  const dest = getAddress(to);
  if (dest === from) throw new Error("the receiver is the signer itself");
  const kept = ids.filter((id) => keep.includes(id));
  if (kept.length > 0) throw new Error(`circuit ${kept.join(", ")} must stay with the signer`);
  if ((await client.getCode({ address: dest })) === undefined) throw new Error(`${dest} has no code; hand the circuits to the team Safe, not to a plain address`);

  const owners = await Promise.all(ids.map((id) => client.readContract({ address: circuits, abi: circuitsAbi, functionName: "ownerOf", args: [id] })));
  ids.forEach((id, i) => {
    const owner = getAddress(owners[i]!);
    if (owner !== from && owner !== dest) throw new Error(`circuit ${id} is held by ${owner}, not by the signer ${from}`);
  });

  const done: Handover[] = [];
  for (const [i, id] of ids.entries()) {
    if (getAddress(owners[i]!) === dest) {
      done.push({ id, hash: null });
      continue;
    }
    const hash = await wallet.writeContract({ address: circuits, abi: circuitsAbi, functionName: "transferFrom", args: [from, dest, id], chain: wallet.chain });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    const owner = await client.readContract({ address: circuits, abi: circuitsAbi, functionName: "ownerOf", args: [id] });
    if (getAddress(owner) !== dest) throw new Error(`circuit ${id} is still held by ${owner} after ${hash}`);
    done.push({ id, hash });
  }
  return done;
}
