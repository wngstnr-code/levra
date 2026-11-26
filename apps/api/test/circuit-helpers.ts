import { xlayerTapeout } from "@levra/shared/addresses";
import { packBits, riskCircuit, simulate, unpackBits, wallStreetClock, type Gate, type RiskLimits } from "@levra/tapeout";
import type { Hex, PublicClient } from "viem";
import type { MarketState } from "../src/chain/reader";

export const pct = (bps: bigint) => (bps * 10n ** 18n) / 10_000n;
export const L77: RiskLimits = { lltvWad: pct(7700n), softOpenWad: pct(7300n), softClosedWad: pct(7000n) };
export const L62: RiskLimits = { lltvWad: pct(6250n), softOpenWad: pct(5800n), softClosedWad: pct(5000n) };
export const USDC = 10n ** 6n;

type Built = { gates: Gate[]; nIn: number; nOut: number; netlist: Hex };
const onchain: Record<number, Built> = {
  [xlayerTapeout.circuits.risk77]: riskCircuit(L77),
  [xlayerTapeout.circuits.risk62_5]: riskCircuit(L62),
  [xlayerTapeout.circuits.wallStreetClock]: wallStreetClock(2026, 2030),
};

/** A node that runs the real netlists locally, the way `eval` does onchain. */
export function fakeNode(opts: { flip?: boolean; fail?: boolean; hang?: boolean } = {}) {
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

/** A long market at $100 with the given limits, in the regular session. */
export function market(limits: RiskLimits, over: Partial<MarketState> = {}): MarketState {
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
