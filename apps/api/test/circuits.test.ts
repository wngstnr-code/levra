import { xlayerTapeout } from "@levra/shared/addresses";
import { packBits, riskCircuit, simulate, unpackBits, wallStreetClock, type Gate, type RiskLimits } from "@levra/tapeout";
import type { Hex, PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { createCircuits, positionAmounts, sessionInputs, valueAfterGap } from "../src/chain/circuits";
import type { MarketState } from "../src/chain/reader";

const pct = (bps: bigint) => (bps * 10n ** 18n) / 10_000n;
const L77: RiskLimits = { lltvWad: pct(7700n), softOpenWad: pct(7300n), softClosedWad: pct(7000n) };
const L62: RiskLimits = { lltvWad: pct(6250n), softOpenWad: pct(5800n), softClosedWad: pct(5000n) };
const USDC = 10n ** 6n;

type Built = { gates: Gate[]; nIn: number; nOut: number; netlist: Hex };
const onchain: Record<number, Built> = {
  [xlayerTapeout.circuits.risk77]: riskCircuit(L77),
  [xlayerTapeout.circuits.risk62_5]: riskCircuit(L62),
  [xlayerTapeout.circuits.wallStreetClock]: wallStreetClock(2026, 2030),
};

/** A node that runs the real netlists locally, the way `eval` does onchain. */
function fakeNode(opts: { flip?: boolean; fail?: boolean; hang?: boolean } = {}) {
  const calls = { eval: 0, netlist: 0 };
  const client = {
    readContract: async ({ functionName, args }: { functionName: string; args: [bigint, Hex?] }) => {
      const c = onchain[Number(args[0])]!;
      if (functionName === "netlist") {
        calls.netlist += 1;
        return c.netlist;
      }
      calls.eval += 1;
      if (opts.fail) throw new Error("execution reverted");
      if (opts.hang) return new Promise(() => {});
      const out = simulate(c.gates, c.nIn, c.nOut, unpackBits(args[1]!, c.nIn));
      return packBits(opts.flip ? out.map((b) => !b) : out);
    },
  } as unknown as PublicClient;
  return { client, calls };
}

function market(limits: RiskLimits, over: Partial<MarketState> = {}): MarketState {
  return {
    info: { side: "long", stock: { decimals: 18 } },
    oraclePriceE8: 100n * 10n ** 8n,
    bidE8: 0n,
    askE8: 0n,
    lltvWad: limits.lltvWad,
    softLtvOpenWad: limits.softOpenWad!,
    softLtvClosedWad: limits.softClosedWad!,
    currentSoftLtvWad: limits.softOpenWad!,
    session: "REGULAR",
    ...over,
  } as unknown as MarketState;
}

describe("circuit inputs", () => {
  it("values a long's stock in USDC at the Morpho price", () => {
    expect(positionAmounts(market(L77), 10n ** 18n, 50n * USDC, 6)).toEqual({ debt: 50n * USDC, value: 100n * USDC });
  });

  it("values a short's USDC in stock at the Morpho price", () => {
    const short = market(L77, { info: { side: "short", stock: { decimals: 18 } } } as Partial<MarketState>);
    expect(positionAmounts(short, 100n * USDC, 5n * 10n ** 17n, 6)).toEqual({ debt: 5n * 10n ** 17n, value: 10n ** 18n });
  });

  it("has no inputs without a price", () => {
    expect(positionAmounts(market(L77, { oraclePriceE8: 0n }), 10n ** 18n, 1n, 6)).toBeNull();
  });

  it("moves a long's value with the price and a short's against it", () => {
    expect(valueAfterGap("long", 100n * USDC, -1_000)).toBe(90n * USDC);
    expect(valueAfterGap("short", 110n * USDC, 1_000)).toBe(100n * USDC);
    expect(valueAfterGap("long", 100n * USDC, -10_000)).toBe(0n);
  });

  it("shows the pre-close window as the flag, and only in an open session", () => {
    expect(sessionInputs(market(L77))).toEqual({ session: "REGULAR", preClose: false });
    expect(sessionInputs(market(L77, { currentSoftLtvWad: L77.softClosedWad! }))).toEqual({ session: "REGULAR", preClose: true });
    expect(sessionInputs(market(L77, { session: "CLOSED", currentSoftLtvWad: L77.softClosedWad! }))).toEqual({ session: "CLOSED", preClose: false });
  });
});

describe("risk circuit answers", () => {
  const at = (debt: bigint) => ({ debt: debt * USDC, value: 100n * USDC });

  it("answers from the circuit whose netlist holds the market's limits", async () => {
    const { client } = fakeNode();
    const circuits = createCircuits(client);
    expect(await circuits.risk(market(L77), at(50n))).toEqual({ processor: xlayerTapeout.processor, circuitId: 2, healthy: true, belowSoftLimit: true, matches: true });
    expect(await circuits.risk(market(L77), at(75n))).toMatchObject({ healthy: true, belowSoftLimit: false, matches: true });
    expect(await circuits.risk(market(L77), at(78n))).toMatchObject({ healthy: false, belowSoftLimit: false, matches: true });
    expect(await circuits.risk(market(L62), at(60n))).toMatchObject({ circuitId: 3, healthy: true, belowSoftLimit: false, matches: true });
  });

  it("uses the closed soft limit in the pre-close window", async () => {
    const circuits = createCircuits(fakeNode().client);
    expect(await circuits.risk(market(L77, { currentSoftLtvWad: L77.softClosedWad! }), at(72n))).toMatchObject({ belowSoftLimit: false, matches: true });
  });

  it("reads the netlists once", async () => {
    const node = fakeNode();
    const circuits = createCircuits(node.client);
    await circuits.risk(market(L77), at(50n));
    await circuits.risk(market(L77), at(60n));
    expect(node.calls.netlist).toBe(2);
  });

  it("gives no answer for limits no circuit holds", async () => {
    const circuits = createCircuits(fakeNode().client);
    expect(await circuits.risk(market({ lltvWad: pct(8000n), softOpenWad: pct(7300n), softClosedWad: pct(7000n) }), at(50n))).toBeNull();
  });

  it("flags a circuit that disagrees with math.ts", async () => {
    const circuits = createCircuits(fakeNode({ flip: true }).client);
    expect(await circuits.risk(market(L77), at(50n))).toMatchObject({ healthy: false, matches: false });
  });

  it("gives no answer when the circuit fails, hangs or the amounts are too large", async () => {
    expect(await createCircuits(fakeNode({ fail: true }).client).risk(market(L77), at(50n))).toBeNull();
    expect(await createCircuits(fakeNode({ hang: true }).client, { timeoutMs: 20 }).risk(market(L77), at(50n))).toBeNull();
    expect(await createCircuits(fakeNode().client).risk(market(L77), { debt: 1n << 80n, value: 1n << 81n })).toBeNull();
    expect(await createCircuits(fakeNode().client).risk(market(L77), null)).toBeNull();
  });
});

describe("gap check", () => {
  it("answers after the worst gap", async () => {
    const circuits = createCircuits(fakeNode().client);
    const pos = { debt: 70n * USDC, value: 100n * USDC };
    expect(await circuits.gap(market(L77), pos, -1_000)).toEqual({ processor: xlayerTapeout.processor, circuitId: 2, moveBps: -1_000, healthyAfterGap: false, matches: true });
    expect(await circuits.gap(market(L77), pos, -500)).toMatchObject({ healthyAfterGap: true, matches: true });
    expect(await circuits.gap(market(L77), pos, undefined)).toBeNull();
  });
});

describe("clock circuit", () => {
  // Thursday 26 November 2026, 15:00 UTC: Thanksgiving, closed.
  const thanksgiving = Date.UTC(2026, 10, 26, 15) / 1_000;
  // Friday 27 November 2026, 15:00 UTC: regular hours on an early close day.
  const friday = Date.UTC(2026, 10, 27, 15) / 1_000;

  it("reads the session and agrees with calendar.ts", async () => {
    const circuits = createCircuits(fakeNode().client);
    expect(await circuits.clock(thanksgiving)).toMatchObject({ circuitId: 1, session: "CLOSED", holiday: true, matches: true });
    expect(await circuits.clock(friday)).toMatchObject({ session: "REGULAR", earlyClose: true, matches: true });
  });

  it("keeps one answer per minute and asks again after a failure", async () => {
    const node = fakeNode();
    const circuits = createCircuits(node.client);
    await circuits.clock(friday);
    await circuits.clock(friday + 30);
    expect(node.calls.eval).toBe(1);

    const failing = fakeNode({ fail: true });
    const c2 = createCircuits(failing.client);
    expect(await c2.clock(friday)).toBeNull();
    expect(await c2.clock(friday)).toBeNull();
    expect(failing.calls.eval).toBe(2);
  });

  it("flags a clock that disagrees with calendar.ts", async () => {
    expect(await createCircuits(fakeNode({ flip: true }).client).clock(friday)).toMatchObject({ matches: false });
  });
});
