import type { PublicClient } from "viem";
import type { LogSource, RawLog } from "./types";

/** Blocks per log query: rpc2.monad.xyz and base-rpc.publicnode.com allow 10,000, rpc.xlayer.tech about 100 (05). */
export function rpcSource(client: PublicClient, blockRange = 10_000n): LogSource {
  if (blockRange < 1n) throw new Error("blockRange must be at least 1");
  return {
    name: "rpc",
    head: () => client.getBlockNumber(),
    async logs({ address, topic0, topic1, fromBlock, toBlock }) {
      const to = fromBlock + blockRange - 1n < toBlock ? fromBlock + blockRange - 1n : toBlock;
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
