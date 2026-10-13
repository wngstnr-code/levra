import { anchoredStockOracleAbi } from "@levra/shared/abis";
import { sessionName, type SessionName } from "@levra/shared/api";
import { stocks, type StockSymbol } from "@levra/shared/markets";
import type { oracleUpdates } from "@levra/db";
import { getAbiItem, type Hex, type Log } from "viem";

export const priceUpdatedEvent = getAbiItem({ abi: anchoredStockOracleAbi, name: "PriceUpdated" });

export type PriceUpdatedLog = Log<bigint, number, false, typeof priceUpdatedEvent, true>;

const symbolByPriceId = new Map<Hex, StockSymbol>(
  Object.values(stocks).map((s) => [s.priceId.toLowerCase() as Hex, s.symbol]),
);

export const trackedPriceIds = Object.values(stocks).map((s) => s.priceId);

export function sessionFromIndex(index: number): SessionName {
  const name = sessionName.options[index];
  if (name === undefined) throw new Error(`Unknown oracle session index ${index}`);
  return name;
}

function toDate(unixSeconds: bigint): Date {
  return new Date(Number(unixSeconds) * 1000);
}

export function toOracleRow(log: PriceUpdatedLog): typeof oracleUpdates.$inferInsert {
  const { priceId, price, bestBid, bestAsk, feedUpdateTimestamp, publishedAt, roundId, session } = log.args;
  const symbol = symbolByPriceId.get(priceId.toLowerCase() as Hex);
  if (!symbol) throw new Error(`Log for a price id we do not track: ${priceId}`);
  if (log.blockTimestamp === undefined) throw new Error(`RPC returned no blockTimestamp for block ${log.blockNumber}`);
  return {
    symbol,
    priceId,
    roundId: roundId.toString(),
    priceE8: price.toString(),
    bestBidE8: bestBid.toString(),
    bestAskE8: bestAsk.toString(),
    session: sessionFromIndex(session),
    feedUpdatedAt: toDate(feedUpdateTimestamp),
    publishedAt: toDate(publishedAt),
    blockNumber: log.blockNumber,
    blockTime: toDate(log.blockTimestamp),
    txHash: log.transactionHash,
    logIndex: log.logIndex,
  };
}
