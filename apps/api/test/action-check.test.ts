import type { PrepareRequest } from "@levra/shared/api";
import { getAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { actionCircuitCheck } from "../src/chain/action-check";
import { createCircuits } from "../src/chain/circuits";
import type { ChainReader, MarketState, PositionState } from "../src/chain/reader";
import { L77, USDC, fakeNode, market } from "./circuit-helpers";

const user = getAddress("0x00000000000000000000000000000000000a6e77");
const marketId = `0x${"11".repeat(32)}` as const;
const STOCK = 10n ** 18n;
// Friday 27 November 2026, 15:00 UTC: regular hours on an early close day.
const friday = Date.UTC(2026, 10, 27, 15);

const m: MarketState = market(L77, { info: { side: "long", stock: { decimals: 18 }, marketId } } as Partial<MarketState>);

function reader(pos: Partial<PositionState> | null, opts: { circuits?: boolean; failPositions?: boolean; hangPositions?: boolean } = {}) {
  return {
    circuits: opts.circuits === false ? null : createCircuits(fakeNode().client),
    usdc: { decimals: 6 },
    markets: async () => [m],
    positions: async (_: Address) => {
      if (opts.failPositions) throw new Error("rpc down");
      if (opts.hangPositions) return new Promise(() => {});
      return pos ? [{ marketId, side: "long", ...pos }] : [];
    },
  } as unknown as ChainReader;
}

const close = (fractionWad: string): PrepareRequest => ({ kind: "close", request: { user, marketId, fractionWad, slippageBps: 50 } });
const collateral = (action: "add" | "remove" | "repay", amountRaw: bigint): PrepareRequest => ({
  kind: "collateral",
  request: { user, marketId, action, amountRaw: amountRaw.toString() },
});

describe("circuit check of a prepared action (BE-87)", () => {
  it("checks an open on the position its quote ends with, and passes the quote's gap check on", async () => {
    const gap = { processor: "0x4D5Bf68e1362046B0281b9bA678345b7FD2aAa5c", circuitId: 2, moveBps: -1_000, healthyAfterGap: true, matches: true };
    const open: PrepareRequest = { kind: "open", request: { user, symbol: "NVDA", side: "long", marginRaw: "50000000", leverageE2: 200, slippageBps: 50 } };
    const quote = { market: { marketId }, preview: { collateralRaw: STOCK.toString(), debtRaw: (50n * USDC).toString(), circuitGapCheck: gap } };
    const check = await actionCircuitCheck(reader(null), open, quote, friday);
    expect(check).toMatchObject({ risk: { circuitId: 2, healthy: true, belowSoftLimit: true, matches: true }, gap, clock: { session: "REGULAR", earlyClose: true, matches: true } });
  });

  it("checks a partial close on what is left, and nothing after a full close", async () => {
    const pos = { collateralRaw: STOCK, debtRaw: 76n * USDC };
    const partial = { preview: { collateralWithdrawnRaw: (STOCK / 5n).toString(), debtRepaidRaw: (38n * USDC).toString() } };
    expect(await actionCircuitCheck(reader(pos), close("200000000000000000"), partial, friday)).toMatchObject({ risk: { healthy: true, belowSoftLimit: true }, gap: null });

    const full = { preview: { collateralWithdrawnRaw: STOCK.toString(), debtRepaidRaw: (76n * USDC).toString() } };
    expect(await actionCircuitCheck(reader(pos), close("1000000000000000000"), full, friday)).toMatchObject({ risk: null, gap: null, clock: { matches: true } });
  });

  it("checks removing collateral and repaying on the position after them", async () => {
    const pos = { collateralRaw: STOCK, debtRaw: 70n * USDC };
    const removed = { preview: { collateralAfterRaw: ((STOCK * 9n) / 10n).toString() } };
    expect(await actionCircuitCheck(reader(pos), collateral("remove", STOCK / 10n), removed, friday)).toMatchObject({ risk: { healthy: false, matches: true } });

    const repaid = { preview: { collateralAfterRaw: STOCK.toString() } };
    expect(await actionCircuitCheck(reader(pos), collateral("repay", 40n * USDC), repaid, friday)).toMatchObject({ risk: { healthy: true, belowSoftLimit: true } });
  });

  it("gives no risk answer without a position, and no check off X Layer or when the chain read fails", async () => {
    const added = { preview: { collateralAfterRaw: STOCK.toString() } };
    expect(await actionCircuitCheck(reader(null), collateral("add", STOCK), added, friday)).toMatchObject({ risk: null, clock: { matches: true } });
    expect(await actionCircuitCheck(reader(null, { circuits: false }), collateral("add", STOCK), added, friday)).toBeNull();
    expect(await actionCircuitCheck(reader(null, { failPositions: true }), collateral("add", STOCK), added, friday)).toBeNull();
    expect(await actionCircuitCheck(reader(null, { hangPositions: true }), collateral("add", STOCK), added, friday, 20)).toBeNull();
  });
});
