import { mintAndWithdrawEvent, TOKEN_MESSENGER_V2 } from "@levra/cctp";
import type { Address, Hex, PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { cctpArrivals } from "../src/alerts/arrivals";

const USDC = "0x0000000000000000000000000000000000000c01" as Address;
const USER = "0x00000000000000000000000000000000000000A1" as Address;

type Mint = { block: bigint; recipient: Address; amount: bigint; token?: Address };

/** A chain whose head moves as the test says, with CCTP mints in some blocks, 2 seconds apart. */
function chain(mints: Mint[]) {
  const state = { head: 1_000n, queries: [] as [bigint, bigint][] };
  const client = {
    getBlockNumber: async () => state.head,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1_800_000_000n + blockNumber * 2n }),
    async getLogs({ address, event, args, fromBlock, toBlock }: { address: Address; event: unknown; args: { mintRecipient: Address[]; mintToken: Address }; fromBlock: bigint; toBlock: bigint }) {
      expect(address).toBe(TOKEN_MESSENGER_V2);
      expect(event).toBe(mintAndWithdrawEvent);
      state.queries.push([fromBlock, toBlock]);
      return mints
        .filter((m) => m.block >= fromBlock && m.block <= toBlock && args.mintRecipient.includes(m.recipient) && (m.token ?? USDC) === args.mintToken)
        .map((m) => ({ args: { mintRecipient: m.recipient, amount: m.amount }, transactionHash: `0x${m.block.toString(16).padStart(64, "0")}` as Hex, logIndex: 0, blockNumber: m.block }));
    },
  };
  return { state, client: client as unknown as PublicClient };
}

const nowAt = (block: bigint) => () => 1_800_000_000 + Number(block) * 2;

describe("CCTP arrivals (BE-76)", () => {
  it("reads 600 blocks back on the first run, in steps of 100, and only USDC to the given wallets", async () => {
    const { state, client } = chain([
      { block: 350n, recipient: USER, amount: 1n },
      { block: 450n, recipient: USER, amount: 5_000_000n },
      { block: 451n, recipient: USER, amount: 7n, token: "0x0000000000000000000000000000000000000bad" },
      { block: 452n, recipient: "0x00000000000000000000000000000000000000B2", amount: 9n },
    ]);
    const read = cctpArrivals(client, USDC, nowAt(1_000n));
    const got = await read([USER]);
    expect(got.map((a) => [a.blockNumber, a.amount, a.blockTime])).toEqual([[450n, 5_000_000n, 1_800_000_900]]);
    expect(state.queries[0]).toEqual([400n, 499n]);
    expect(state.queries.at(-1)).toEqual([1_000n, 1_000n]);
    expect(state.queries.every(([f, t]) => t - f < 100n)).toBe(true);
  });

  it("goes on from the last block read, and offers a recent arrival again so a failed send is retried", async () => {
    const { state, client } = chain([
      { block: 900n, recipient: USER, amount: 1_000_000n },
      { block: 1_050n, recipient: USER, amount: 2_000_000n },
    ]);
    const read = cctpArrivals(client, USDC, nowAt(1_100n));
    expect((await read([USER])).map((a) => a.amount)).toEqual([1_000_000n]);
    state.head = 1_100n;
    state.queries = [];
    expect((await read([USER])).map((a) => a.amount)).toEqual([1_000_000n, 2_000_000n]);
    expect(state.queries[0]![0]).toBe(1_001n);
  });

  it("keeps up with no wallet to watch, forgets arrivals after a day, and skips what is older than 6,000 blocks", async () => {
    const { state, client } = chain([{ block: 2_000n, recipient: USER, amount: 3n }]);
    let now = nowAt(1_000n);
    const read = cctpArrivals(client, USDC, () => now());
    expect(await read([])).toEqual([]);
    expect(state.queries).toEqual([]);
    state.head = 2_100n;
    expect((await read([USER])).map((a) => a.amount)).toEqual([3n]);
    now = nowAt(2_000n + 43_201n);
    expect(await read([USER])).toEqual([]);
    state.head = 20_000n;
    state.queries = [];
    await read([USER]);
    expect(state.queries[0]![0]).toBe(14_000n);
  });
});
