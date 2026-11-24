import { describe, expect, it } from "vitest";
import { toEventSelector, type PublicClient } from "viem";
import { routerTopics, toRouterRow } from "../src/router";
import { loadEnv } from "../src/env";
import { hyperSyncSource, parseHyperSyncPage } from "../src/sources/hypersync";
import { rpcSource } from "../src/sources/rpc";
import { marketId, openedLog, user } from "./fixtures";

describe("RPC log source", () => {
  const calls: { fromBlock: string; toBlock: string }[] = [];
  const client = {
    getBlockNumber: async () => 1_000n,
    request: async ({ params }: { params: [{ fromBlock: string; toBlock: string }] }) => {
      calls.push(params[0]);
      return [];
    },
  } as unknown as PublicClient;

  it("asks for at most the given number of blocks, for an endpoint like rpc.xlayer.tech", async () => {
    calls.length = 0;
    const page = await rpcSource(client, 100n).logs({ address: user, topic0: ["0x01"], fromBlock: 200n, toBlock: 900n });
    expect(calls[0]).toMatchObject({ fromBlock: "0xc8", toBlock: "0x12b" });
    expect(page.nextBlock).toBe(300n);
  });

  it("keeps 10,000 blocks by default and stops at the requested end", async () => {
    calls.length = 0;
    const page = await rpcSource(client).logs({ address: user, topic0: ["0x01"], fromBlock: 0n, toBlock: 20_000n });
    expect(calls[0]).toMatchObject({ toBlock: "0x270f" });
    expect(page.nextBlock).toBe(10_000n);
    expect((await rpcSource(client, 100n).logs({ address: user, topic0: ["0x01"], fromBlock: 950n, toBlock: 960n })).nextBlock).toBe(961n);
  });

  it("refuses a range below one block", () => {
    expect(() => rpcSource(client, 0n)).toThrow("blockRange");
  });

  it("reads LOG_BLOCK_RANGE from the environment, 10,000 when unset", () => {
    const base = { DATABASE_URL: "postgres://u:p@localhost/db", DEPLOYMENT_FILE: "x.json", CHAIN_ID: "196", RPC_URL: "https://rpc.xlayer.tech" };
    expect(loadEnv(base).LOG_BLOCK_RANGE).toBe(10_000);
    expect(loadEnv({ ...base, LOG_BLOCK_RANGE: "100" }).LOG_BLOCK_RANGE).toBe(100);
    expect(() => loadEnv({ ...base, LOG_BLOCK_RANGE: "0" })).toThrow();
  });
});

describe("router events", () => {
  it("follows every router event the API shows, including DebtRepaid", () => {
    expect(routerTopics).toHaveLength(6);
    expect(routerTopics).toContain(toEventSelector("DebtRepaid(address,bytes32,uint256)"));
  });

  it("decodes PositionOpened with every integer as a decimal string", () => {
    const row = toRouterRow(openedLog(100n));
    expect(row).toMatchObject({ name: "PositionOpened", user, marketId, blockNumber: 100n, logIndex: 0 });
    expect(row.args).toMatchObject({ side: 0, margin: "50000000", collateralDelta: "135000000000000000", fee: "100000" });
  });
});

describe("HyperSync page", () => {
  const log = openedLog(5n, 2);

  it("joins block timestamps and accepts numbers or hex strings", () => {
    const page = parseHyperSyncPage({
      data: [
        {
          blocks: [{ number: 5, timestamp: "0x6acddc48" }],
          logs: [
            {
              block_number: 5,
              log_index: "0x2",
              transaction_hash: log.txHash,
              address: log.address,
              topic0: log.topics[0],
              topic1: log.topics[1] ?? null,
              topic2: log.topics[2] ?? null,
              topic3: null,
              data: log.data,
            },
          ],
        },
      ],
      next_block: 9,
    });
    expect(page.nextBlock).toBe(9n);
    expect(page.logs).toHaveLength(1);
    expect(page.logs[0]).toMatchObject({ blockNumber: 5n, blockTime: 0x6acddc48, logIndex: 2 });
    expect(toRouterRow(page.logs[0]!).name).toBe("PositionOpened");
  });

  it("sends the token, asks with an exclusive to_block and never runs past the requested range", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [], next_block: 500 }), { status: 200 });
    }) as unknown as typeof fetch;
    const source = hyperSyncSource({ url: "https://monad.hypersync.xyz", token: "t0k", fetchFn });

    const page = await source.logs({ address: log.address, topic0: [log.topics[0]], fromBlock: 10n, toBlock: 20n });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe("https://monad.hypersync.xyz/query");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer t0k");
    expect(body).toMatchObject({ from_block: 10, to_block: 21 });
    expect(page.nextBlock).toBe(21n);
  });
});
