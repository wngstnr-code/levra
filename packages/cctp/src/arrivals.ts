import { getAddress, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { TOKEN_MESSENGER_V2 } from "./chains";

/**
 * Emitted by TokenMessengerV2 on the destination chain for every CCTP mint. `amount` is what the recipient received;
 * `feeCollected` went to Circle's fee recipient on top of it (both read from real Base mints on 25 November 2026).
 */
export const mintAndWithdrawEvent = parseAbiItem(
  "event MintAndWithdraw(address indexed mintRecipient, uint256 amount, address indexed mintToken, uint256 feeCollected)",
);

/** Blocks per log query: X Layer's public RPC refuses more than 100. */
export const ARRIVAL_BLOCK_RANGE = 100n;

export type Arrival = { recipient: Address; amount: bigint; txHash: Hex; logIndex: number; blockNumber: bigint };

/** CCTP mints of `usdc` to any of `recipients` from `fromBlock` to `toBlock`, both included. */
export async function readArrivals(
  client: PublicClient,
  { usdc, recipients, fromBlock, toBlock }: { usdc: Address; recipients: readonly Address[]; fromBlock: bigint; toBlock: bigint },
): Promise<Arrival[]> {
  const out: Arrival[] = [];
  if (recipients.length === 0) return out;
  for (let from = fromBlock; from <= toBlock; from += ARRIVAL_BLOCK_RANGE) {
    const to = from + ARRIVAL_BLOCK_RANGE - 1n < toBlock ? from + ARRIVAL_BLOCK_RANGE - 1n : toBlock;
    const logs = await client.getLogs({
      address: TOKEN_MESSENGER_V2,
      event: mintAndWithdrawEvent,
      args: { mintRecipient: [...recipients], mintToken: usdc },
      fromBlock: from,
      toBlock: to,
    });
    for (const l of logs) {
      out.push({ recipient: getAddress(l.args.mintRecipient!), amount: l.args.amount!, txHash: l.transactionHash, logIndex: l.logIndex, blockNumber: l.blockNumber });
    }
  }
  return out;
}
