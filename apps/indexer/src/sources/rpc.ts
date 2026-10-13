import type { PublicClient } from "viem";
import type { LogSource, RawLog } from "./types";

/** rpc2.monad.xyz allows at most 10,000 blocks per log query (02). */
const BLOCK_RANGE = 10_000n;

export function rpcSource(client: PublicClient): LogSource {
  return {
    name: "rpc",
    head: () => client.getBlockNumber(),
    async logs({ address, topic0, topic1, fromBlock, toBlock }) {
      const to = fromBlock + BLOCK_RANGE - 1n < toBlock ? fromBlock + BLOCK_RANGE - 1n : toBlock;
      const logs = await client.request({
        method: "eth_getLogs",
        params: [{ address, topics: topic1 ? [topic0, topic1] : [topic0], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
      });
      const out: RawLog[] = logs.map((l) => {
        const blockTimestamp = (l as { blockTimestamp?: string }).blockTimestamp;
        if (!blockTimestamp) throw new Error(`RPC returned no blockTimestamp for block ${l.blockNumber}`);
        return {
          blockNumber: BigInt(l.blockNumber ?? "0x0"),
          blockTime: Number(BigInt(blockTimestamp)),
          logIndex: Number(BigInt(l.logIndex ?? "0x0")),
          txHash: l.transactionHash ?? "0x",
          address: l.address,
          topics: l.topics as RawLog["topics"],
          data: l.data,
        };
      });
      return { logs: out, nextBlock: to + 1n };
    },
  };
}
