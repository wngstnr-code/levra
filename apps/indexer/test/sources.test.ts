import { describe, expect, it } from "vitest";
import { toEventSelector } from "viem";
import { routerTopics, toRouterRow } from "../src/router";
import { hyperSyncSource, parseHyperSyncPage } from "../src/sources/hypersync";
import { marketId, openedLog, user } from "./fixtures";

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
