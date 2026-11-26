import { morphoEvents, routerEvents, vaultEvents, type Db } from "@levra/db";
import { byChainOrder, type StoredEvent } from "@levra/positions";
import { and, asc, eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import type { ChainReader } from "../chain/reader";

export { byChainOrder, toCostEvents, type StoredEvent } from "@levra/positions";

export type EventStore = {
  /** All router and Morpho events of a user in our markets, oldest first. */
  forUser(user: Address): Promise<StoredEvent[]>;
};

type Row = Omit<typeof routerEvents.$inferSelect, "router">;

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

/** The indexer's copy in Postgres, for one chain. This is what the API uses in every environment. */
export function dbEventStore(db: Db, chainId: number): EventStore {
  return {
    async forUser(user) {
      const who = user.toLowerCase();
      const [router, morpho, vault] = await Promise.all([
        db.select().from(routerEvents).where(and(eq(routerEvents.chainId, chainId), eq(routerEvents.user, who))).orderBy(asc(routerEvents.blockNumber), asc(routerEvents.logIndex)),
        db.select().from(morphoEvents).where(and(eq(morphoEvents.chainId, chainId), eq(morphoEvents.user, who))).orderBy(asc(morphoEvents.blockNumber), asc(morphoEvents.logIndex)),
        db.select().from(vaultEvents).where(and(eq(vaultEvents.chainId, chainId), eq(vaultEvents.user, who))).orderBy(asc(vaultEvents.blockNumber), asc(vaultEvents.logIndex)),
      ]);
      return [
        ...router.map(toStored("router")),
        ...morpho.map(toStored("morpho")),
        ...vault.map((r) => toStored("vault")({ ...r, marketId: r.vault })),
      ].sort(byChainOrder);
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
