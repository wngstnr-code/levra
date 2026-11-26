import type { Hex } from "viem";

/** The router and Morpho events the cost basis needs, decoded. */
export type RouterEvent =
  | { kind: "opened"; marketId: Hex; block: bigint; logIndex: number; margin: bigint; collateralDelta: bigint; debtDelta: bigint; fee: bigint }
  | { kind: "reduced"; marketId: Hex; block: bigint; logIndex: number; collateralDelta: bigint; debtDelta: bigint; returned: bigint; fee: bigint; reason: number }
  | { kind: "repaid"; marketId: Hex; block: bigint; logIndex: number; assets: bigint }
  | { kind: "liquidated"; marketId: Hex; block: bigint; logIndex: number; seized: bigint; repaid?: bigint };

/** One router or Morpho event as stored by the indexer, with its place in the chain. */
export type StoredEvent = {
  /** `vault` events carry the vault address as `marketId` (BE-22). */
  source: "router" | "morpho" | "vault";
  name: string;
  marketId: Hex;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTime: number;
  args: Record<string, string | number | boolean>;
};

export const byChainOrder = (a: StoredEvent, b: StoredEvent) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

const big = (v: string | number | boolean | undefined) => BigInt(typeof v === "boolean" ? Number(v) : (v ?? 0));

/** The events the cost basis needs, from stored rows. */
export function toCostEvents(events: StoredEvent[]): RouterEvent[] {
  return events.flatMap((e): RouterEvent[] => {
    if (e.source === "vault") return [];
    const base = { marketId: e.marketId, block: e.blockNumber, logIndex: e.logIndex };
    if (e.name === "PositionOpened") {
      return [{ kind: "opened", ...base, margin: big(e.args.margin), collateralDelta: big(e.args.collateralDelta), debtDelta: big(e.args.debtDelta), fee: big(e.args.fee) }];
    }
    if (e.source === "morpho") {
      return e.name === "Liquidate" ? [{ kind: "liquidated", ...base, seized: big(e.args.seizedAssets), repaid: big(e.args.repaidAssets) }] : [];
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
