import { stocks } from "@levra/shared/markets";
import type { PriceUpdatedLog } from "../src/oracle/decode";

export function sampleLog(overrides: Partial<PriceUpdatedLog["args"]> = {}, blockNumber = 100n, logIndex = 0): PriceUpdatedLog {
  return {
    address: "0x037848af338c38e1e0ab722be80bf4c2e612a1f7",
    blockHash: "0x01",
    blockNumber,
    blockTimestamp: 1_791_876_168n,
    data: "0x",
    logIndex,
    removed: false,
    topics: ["0x2e2fc593ffe55b85f00a028e4a1993370650ee81a0e86df35a306a346b85c07f", stocks.QQQ.priceId],
    transactionHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
    transactionIndex: 0,
    eventName: "PriceUpdated",
    args: {
      priceId: stocks.QQQ.priceId,
      price: 74_562_000_000n,
      bestBid: 74_500_000_000n,
      bestAsk: 74_600_000_000n,
      feedUpdateTimestamp: 1_791_876_162n,
      publishedAt: 1_791_876_168n,
      roundId: 12_111n,
      session: 2,
      ...overrides,
    },
  } as PriceUpdatedLog;
}
