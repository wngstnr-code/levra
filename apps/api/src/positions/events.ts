import { morphoEvents, routerEvents, type Db } from "@levra/db";
import { asc, eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import type { ChainReader, RouterEvent } from "../chain/reader";

/** One router or Morpho event as stored by the indexer, with its place in the chain. */
export type StoredEvent = {
  source: "router" | "morpho";
  name: string;
  marketId: Hex;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTime: number;
  args: Record<string, string | number | boolean>;
};

export type EventStore = {
  /** All router and Morpho events of a user in our markets, oldest first. */
  forUser(user: Address): Promise<StoredEvent[]>;
};

type Row = typeof routerEvents.$inferSelect;

const toStored = (source: StoredEvent["source"]) => (r: Row): StoredEvent => ({
  source,
  name: r.name,
  marketId: r.marketId as Hex,
  txHash: r.txHash as Hex,
  logIndex: r.logIndex,
  blockNumber: r.blockNumber,
  blockTime: Math.floor(r.blockTime.getTime() / 1000),
  args: r.args,
});

export const byChainOrder = (a: StoredEvent, b: StoredEvent) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

/** The indexer's copy in Postgres. This is what the API uses in every environment. */
export function dbEventStore(db: Db): EventStore {
  return {
    async forUser(user) {
      const who = user.toLowerCase();
      const [router, morpho] = await Promise.all([
        db.select().from(routerEvents).where(eq(routerEvents.user, who)).orderBy(asc(routerEvents.blockNumber), asc(routerEvents.logIndex)),
        db.select().from(morphoEvents).where(eq(morphoEvents.user, who)).orderBy(asc(morphoEvents.blockNumber), asc(morphoEvents.logIndex)),
      ]);
      return [...router.map(toStored("router")), ...morpho.map(toStored("morpho"))].sort(byChainOrder);
    },
  };
}

/** Reads the same events straight from chain logs. For tests on a fork without an indexer. */
export function chainEventStore(reader: ChainReader): EventStore {
  return {
    async forUser(user) {
      const events = await reader.routerEvents(user);
      return events.map((e): StoredEvent => ({
        source: "router",
        name: e.kind === "opened" ? "PositionOpened" : e.kind === "reduced" ? "PositionReduced" : e.kind === "repaid" ? "DebtRepaid" : "Liquidate",
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
              : e.kind === "repaid"
                ? { assets: e.assets.toString() }
                : { seizedAssets: e.seized.toString() },
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
    if (e.source === "morpho") {
      return e.name === "Liquidate" ? [{ kind: "liquidated", ...base, seized: big(e.args.seizedAssets) }] : [];
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
