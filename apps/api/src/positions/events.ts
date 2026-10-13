import { routerEvents, type Db } from "@levra/db";
import { and, asc, eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import type { ChainReader, RouterEvent } from "../chain/reader";

/** One router event as stored by the indexer, with its place in the chain. */
export type StoredEvent = {
  name: string;
  marketId: Hex;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTime: number;
  args: Record<string, string | number | boolean>;
};

export type EventStore = {
  /** All router events of a user, oldest first. */
  forUser(user: Address): Promise<StoredEvent[]>;
};

/** The indexer's copy in Postgres. This is what the API uses in every environment. */
export function dbEventStore(db: Db): EventStore {
  return {
    async forUser(user) {
      const rows = await db
        .select()
        .from(routerEvents)
        .where(and(eq(routerEvents.user, user.toLowerCase())))
        .orderBy(asc(routerEvents.blockNumber), asc(routerEvents.logIndex));
      return rows.map((r) => ({
        name: r.name,
        marketId: r.marketId as Hex,
        txHash: r.txHash as Hex,
        logIndex: r.logIndex,
        blockNumber: r.blockNumber,
        blockTime: Math.floor(r.blockTime.getTime() / 1000),
        args: r.args,
      }));
    },
  };
}

/** Reads the same events straight from chain logs. For tests on a fork without an indexer. */
export function chainEventStore(reader: ChainReader): EventStore {
  return {
    async forUser(user) {
      const events = await reader.routerEvents(user);
      return events.map((e): StoredEvent => ({
        name: e.kind === "opened" ? "PositionOpened" : e.kind === "reduced" ? "PositionReduced" : "DebtRepaid",
        marketId: e.marketId,
        txHash: "0x" as Hex,
        logIndex: e.logIndex,
        blockNumber: e.block,
        blockTime: 0,
        args:
          e.kind === "opened"
            ? { margin: e.margin.toString(), collateralDelta: e.collateralDelta.toString(), debtDelta: e.debtDelta.toString(), fee: e.fee.toString() }
            : e.kind === "reduced"
              ? { collateralDelta: e.collateralDelta.toString(), debtDelta: e.debtDelta.toString(), returned: e.returned.toString(), fee: e.fee.toString(), reason: e.reason }
              : { assets: e.assets.toString() },
      }));
    },
  };
}

const big = (v: string | number | boolean | undefined) => BigInt(typeof v === "boolean" ? Number(v) : (v ?? 0));

/** The events the cost basis needs, from stored rows. */
export function toCostEvents(events: StoredEvent[]): RouterEvent[] {
  return events.flatMap((e): RouterEvent[] => {
    const base = { marketId: e.marketId, block: e.blockNumber, logIndex: e.logIndex };
    if (e.name === "PositionOpened") {
      return [{ kind: "opened", ...base, margin: big(e.args.margin), collateralDelta: big(e.args.collateralDelta), debtDelta: big(e.args.debtDelta), fee: big(e.args.fee) }];
    }
    if (e.name === "DebtRepaid") {
      return [{ kind: "repaid", ...base, assets: big(e.args.assets) }];
    }
    if (e.name === "PositionReduced") {
      return [
        {
          kind: "reduced",
          ...base,
          collateralDelta: big(e.args.collateralDelta),
          debtDelta: big(e.args.debtDelta),
          returned: big(e.args.returned),
          fee: big(e.args.fee),
          reason: Number(e.args.reason ?? 0),
        },
      ];
    }
    return [];
  });
}
