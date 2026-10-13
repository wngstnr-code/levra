import type { Address, Hex } from "viem";

export type RawLog = {
  blockNumber: bigint;
  /** Unix seconds. */
  blockTime: number;
  logIndex: number;
  txHash: Hex;
  address: Address;
  topics: [Hex, ...Hex[]];
  data: Hex;
};

export type LogQuery = { address: Address; topic0: Hex[]; fromBlock: bigint; toBlock: bigint };

export type LogPage = {
  logs: RawLog[];
  /** First block not covered by this page. A source may stop before `toBlock`; the caller asks again from here. */
  nextBlock: bigint;
};

export type LogSource = {
  name: "hypersync" | "rpc";
  head(): Promise<bigint>;
  logs(query: LogQuery): Promise<LogPage>;
};
