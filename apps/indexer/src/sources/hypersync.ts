import type { Address, Hex } from "viem";
import type { LogSource, RawLog } from "./types";

/**
 * Envio HyperSync through its JSON API, so it runs on every platform (the native client has no Windows build).
 * `to_block` is exclusive in HyperSync. A response can stop early; `next_block` says where to continue.
 */
export type HyperSyncOptions = { url: string; token: string; fetchFn?: typeof fetch; timeoutMs?: number };

type Num = number | string;
type HsBlock = { number: Num; timestamp: Num };
type HsLog = {
  block_number: Num;
  log_index: Num;
  transaction_hash: Hex;
  address: Address;
  topic0: Hex | null;
  topic1?: Hex | null;
  topic2?: Hex | null;
  topic3?: Hex | null;
  data: Hex;
};
export type HsResponse = { data: { blocks?: HsBlock[]; logs?: HsLog[] }[] | { blocks?: HsBlock[]; logs?: HsLog[] }; next_block: Num };

/** HyperSync sends numbers either as JSON numbers or as hex strings, depending on the field. */
const big = (v: Num): bigint => (typeof v === "number" ? BigInt(v) : BigInt(v));

export function parseHyperSyncPage(body: HsResponse): { logs: RawLog[]; nextBlock: bigint } {
  const batches = Array.isArray(body.data) ? body.data : [body.data];
  const times = new Map<bigint, number>();
  for (const b of batches) for (const block of b.blocks ?? []) times.set(big(block.number), Number(big(block.timestamp)));

  const logs: RawLog[] = [];
  for (const b of batches) {
    for (const l of b.logs ?? []) {
      const blockNumber = big(l.block_number);
      const blockTime = times.get(blockNumber);
      if (blockTime === undefined) throw new Error(`HyperSync returned no timestamp for block ${blockNumber}`);
      const topics = [l.topic0, l.topic1, l.topic2, l.topic3].filter((t): t is Hex => !!t);
      if (topics.length === 0) continue;
      logs.push({
        blockNumber,
        blockTime,
        logIndex: Number(big(l.log_index)),
        txHash: l.transaction_hash,
        address: l.address,
        topics: topics as RawLog["topics"],
        data: l.data,
      });
    }
  }
  return { logs, nextBlock: big(body.next_block) };
}

export function hyperSyncSource({ url, token, fetchFn = fetch, timeoutMs = 20_000 }: HyperSyncOptions): LogSource {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  async function call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetchFn(`${url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HyperSync ${path} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  return {
    name: "hypersync",
    head: async () => BigInt((await call<{ height: number }>("/height")).height),
    async logs({ address, topic0, fromBlock, toBlock }) {
      const body = await call<HsResponse>("/query", {
        from_block: Number(fromBlock),
        to_block: Number(toBlock + 1n),
        logs: [{ address: [address], topics: [topic0] }],
        field_selection: {
          block: ["number", "timestamp"],
          log: ["block_number", "log_index", "transaction_hash", "address", "topic0", "topic1", "topic2", "topic3", "data"],
        },
      });
      const page = parseHyperSyncPage(body);
      return { logs: page.logs, nextBlock: page.nextBlock > toBlock + 1n ? toBlock + 1n : page.nextBlock };
    },
  };
}
