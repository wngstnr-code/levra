import type { routerEvents } from "@levra/db";
import { marginRouterAbi } from "@levra/shared/abis";
import { decodeEventLog, toEventSelector, type Hex } from "viem";
import type { RawLog } from "./sources/types";

const routerEventNames = ["PositionOpened", "PositionReduced", "CollateralAdded", "CollateralRemoved", "ProtectionSet", "DebtRepaid"] as const;

export const routerTopics: Hex[] = marginRouterAbi
  .filter((item) => item.type === "event" && (routerEventNames as readonly string[]).includes(item.name))
  .map((item) => toEventSelector(item as Parameters<typeof toEventSelector>[0]));

function plain(value: unknown): string | number | boolean {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).toLowerCase();
}

export function toRouterRow(log: RawLog): typeof routerEvents.$inferInsert {
  const decoded = decodeEventLog({ abi: marginRouterAbi, data: log.data, topics: log.topics, strict: true });
  const args = decoded.args as Record<string, unknown>;
  const user = args.user;
  const marketId = args.marketId;
  if (typeof user !== "string" || typeof marketId !== "string") throw new Error(`Router event ${decoded.eventName} has no user or market`);
  return {
    name: decoded.eventName,
    user: user.toLowerCase(),
    marketId: marketId.toLowerCase(),
    args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, plain(v)])),
    blockNumber: log.blockNumber,
    blockTime: new Date(log.blockTime * 1000),
    txHash: log.txHash.toLowerCase(),
    logIndex: log.logIndex,
  };
}
