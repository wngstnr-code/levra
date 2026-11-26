import { xlayerTapeout } from "@levra/shared/addresses";
import { createPublicClient, createWalletClient, http, toHex, type Address, type PublicClient } from "viem";
import { xLayer } from "viem/chains";
import { describe, expect, it } from "vitest";
import { circuitsAbi } from "../src/chain";
import { handOverCircuits } from "../src/handover";

/**
 * The risk circuit handover on a fork of X Layer mainnet, as the real TapeOut key (BE-84 known issue).
 * Start `anvil --fork-url https://rpc.xlayer.tech --chain-id 196` and run with XLAYER_FORK_RPC_URL.
 */
const forkUrl = process.env.XLAYER_FORK_RPC_URL;
/** The team Safe, the same address on all three chains (05). */
const SAFE: Address = "0x5e40f4Be2dEF4900Aa7BBe0eb8B7ba733c1Cf069";

describe.skipIf(!forkUrl)("risk circuits to the team Safe on a fork (BE-84)", () => {
  const transport = http(forkUrl, { timeout: 120_000 });
  const client = createPublicClient({ chain: xLayer, transport }) as PublicClient;
  const { processor, operator, circuits } = xlayerTapeout;
  const risk = [BigInt(circuits.risk77), BigInt(circuits.risk62_5)];
  const clock = BigInt(circuits.wallStreetClock);
  const ownerOf = (id: bigint) => client.readContract({ address: processor, abi: circuitsAbi, functionName: "ownerOf", args: [id] });

  it("moves circuits 2 and 3, keeps the clock, refuses a plain address and the clock, and skips on a second run", async () => {
    const rpc = (method: string, params: unknown[]) => client.request({ method: method as never, params: params as never });
    await rpc("anvil_impersonateAccount", [operator]);
    await rpc("anvil_setBalance", [operator, toHex(10n ** 17n)]);
    const wallet = createWalletClient({ account: operator, chain: xLayer, transport });
    const clients = { client, wallet } as unknown as Parameters<typeof handOverCircuits>[0];

    await expect(handOverCircuits(clients, processor, risk, "0x000000000000000000000000000000000000dEaD", [clock])).rejects.toThrow(/no code/);
    await expect(handOverCircuits(clients, processor, [clock], SAFE, [clock])).rejects.toThrow(/must stay/);

    const [nIn] = await client.readContract({ address: processor, abi: circuitsAbi, functionName: "circuitInfo", args: [risk[0]!] });
    const inputs = toHex(new Uint8Array(Math.ceil(nIn / 8)));
    const evalRisk = () => client.readContract({ address: processor, abi: circuitsAbi, functionName: "eval", args: [risk[0]!, inputs] });
    const before = await evalRisk();

    const first = await handOverCircuits(clients, processor, risk, SAFE, [clock]);
    expect(first.every((h) => h.hash !== null)).toBe(true);
    for (const id of risk) expect(await ownerOf(id)).toBe(SAFE);
    expect(await ownerOf(clock)).toBe(operator);
    // Anyone still reads a moved circuit the same way: eval is a view.
    expect(await evalRisk()).toBe(before);

    const again = await handOverCircuits(clients, processor, risk, SAFE, [clock]);
    expect(again).toEqual(risk.map((id) => ({ id, hash: null })));
  }, 120_000);
});
