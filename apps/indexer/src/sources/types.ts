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

/** `topic1`, when given, keeps only logs whose first indexed argument is one of these (for Morpho: our market ids). */
/** `address` may list several contracts, as every router of a deployment (BE-100). */
export type LogQuery = { address: Address | Address[]; topic0: Hex[]; topic1?: Hex[]; fromBlock: bigint; toBlock: bigint };

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
