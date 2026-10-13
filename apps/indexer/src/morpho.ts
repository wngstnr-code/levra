import type { morphoEvents } from "@levra/db";
import { morphoAbi } from "@levra/shared/abis";
import { decodeEventLog, toEventSelector, type Hex } from "viem";
import type { RawLog } from "./sources/types";

/** Position changes, liquidations and lending in a market. `AccrueInterest` is left out: debt comes from shares. */
const morphoEventNames = ["SupplyCollateral", "WithdrawCollateral", "Borrow", "Repay", "Liquidate", "Supply", "Withdraw"] as const;

export const morphoTopics: Hex[] = morphoAbi
  .filter((item) => item.type === "event" && (morphoEventNames as readonly string[]).includes(item.name))
  .map((item) => toEventSelector(item as Parameters<typeof toEventSelector>[0]));

function plain(value: unknown): string | number | boolean {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).toLowerCase();
}

export function toMorphoRow(log: RawLog): typeof morphoEvents.$inferInsert {
  const decoded = decodeEventLog({ abi: morphoAbi, data: log.data, topics: log.topics, strict: true });
  const args = decoded.args as Record<string, unknown>;
  const owner = decoded.eventName === "Liquidate" ? args.borrower : args.onBehalf;
  if (typeof owner !== "string" || typeof args.id !== "string") throw new Error(`Morpho event ${decoded.eventName} has no owner or market`);
  return {
    name: decoded.eventName,
    marketId: args.id.toLowerCase(),
    user: owner.toLowerCase(),
    args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, plain(v)])),
    blockNumber: log.blockNumber,
    blockTime: new Date(log.blockTime * 1000),
    txHash: log.txHash.toLowerCase(),
    logIndex: log.logIndex,
  };
}
