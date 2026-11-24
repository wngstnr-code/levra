import { ORACLE_PRICE_SCALE, WAD, positionLtvWad } from "@levra/shared/math";
import type { Hex } from "viem";
import { CLOCK_SESSIONS, type ClockSession } from "./clock";
import { Logic, type Word } from "./gates";
import { CircuitBuilder, packBits, toBits, unpackBits } from "./netlist";

/**
 * Risk circuit (BE-83, D-66, D-112): where a Morpho position stands against its limits, as a TapeOut circuit any app
 * can `eval`. Soft layer only (D-55): no contract and no hard limit reads it.
 *
 * Every limit check in `math.ts` and `RiskManager` has the form `positionLtvWad(debt, value) <= T` with a constant `T`
 * in WAD, and that holds exactly when `debt * WAD <= T * value`: the LTV is rounded up, and `ceil(x) <= T` is `x <= T`
 * for a whole `T`. The fraction T / WAD is reduced first (77% is 77 / 100), so each check is `debt * m <= value * n`
 * with small constants: a few additions, no full multiplication.
 *
 * Input, LSB first: debt (80 bits) and collateral value (80 bits), both in loan token base units as Morpho counts them
 * (debt rounded up from shares, value `collateral * price() / 1e36` rounded down), then the oracle session (3 bits, the
 * order of `Session` in 03) and the pre-close flag (1 bit, `RiskManager`'s pre-close window). Output: healthy (at or
 * under the hard limit, so not liquidatable), closed regime, at or under the soft limit that applies now, at or under the
 * open soft limit, at or under the closed soft limit.
 */
export const RISK_AMOUNT_BITS = 80;
export const RISK_SESSION_BITS = 3;
export const MAX_RISK_AMOUNT = (1n << BigInt(RISK_AMOUNT_BITS)) - 1n;

export type RiskLimits = {
  /** Morpho's LLTV. */
  lltvWad: bigint;
  /** `RiskManager` soft limits. A plain Morpho market has none: leave them out and they equal the hard limit. */
  softOpenWad?: bigint;
  softClosedWad?: bigint;
};
export type RiskPosition = { debt: bigint; value: bigint; session: ClockSession; preClose: boolean };
export type RiskReading = { healthy: boolean; closedRegime: boolean; belowSoft: boolean; belowSoftOpen: boolean; belowSoftClosed: boolean };

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

function thresholds(limits: RiskLimits) {
  const list = [limits.lltvWad, limits.softOpenWad ?? limits.lltvWad, limits.softClosedWad ?? limits.lltvWad];
  for (const t of list) if (t <= 0n || t > WAD) throw new Error(`limit ${t} must be above 0 and at most 1e18`);
  // One common denominator m, so debt * m is made once: T / WAD = n / m.
  const m = list.reduce((acc, t) => {
    const den = WAD / gcd(t, WAD);
    return (acc * den) / gcd(acc, den);
  }, 1n);
  return { m, n: list.map((t) => (t * m) / WAD) as [bigint, bigint, bigint] };
}

const SESSION_CODE = (s: ClockSession) => BigInt(CLOCK_SESSIONS.indexOf(s));

/** The risk circuit for one market's limits. */
export function riskCircuit(limits: RiskLimits) {
  const { m, n } = thresholds(limits);
  const c = new CircuitBuilder(2 * RISK_AMOUNT_BITS + RISK_SESSION_BITS + 1);
  const g = new Logic(c);
  const word = (from: number, bits: number): Word => Array.from({ length: bits }, (_, i) => c.input(from + i));
  const debt = word(0, RISK_AMOUNT_BITS);
  const value = word(RISK_AMOUNT_BITS, RISK_AMOUNT_BITS);
  const session = word(2 * RISK_AMOUNT_BITS, RISK_SESSION_BITS);
  const preClose = c.input(2 * RISK_AMOUNT_BITS + RISK_SESSION_BITS);

  const debtM = m === 1n ? debt : g.mulConst(debt, m);
  const products = new Map<bigint, Word>();
  const atOrUnder = (k: bigint) => {
    let vk = products.get(k);
    if (!vk) {
      vk = k === 1n ? value : g.mulConst(value, k);
      products.set(k, vk);
    }
    return g.le(debtM, vk);
  };
  const healthy = atOrUnder(n[0]);
  const underOpen = atOrUnder(n[1]);
  const underClosed = atOrUnder(n[2]);

  // RiskManager.currentSoftLtv: the closed limit in the pre-close window or when the session is CLOSED or UNKNOWN.
  // Codes 6 and 7 are no session at all and count as closed, as an oracle that cannot be read does.
  const open = g.any(["PRE_MARKET", "REGULAR", "POST_MARKET", "OVERNIGHT"].map((s) => g.eqConst(session, SESSION_CODE(s as ClockSession))));
  const closedRegime = g.or(preClose, g.not(open));
  const underSoft = g.mux(closedRegime, underClosed, underOpen);

  return c.finish([healthy, closedRegime, underSoft, underOpen, underClosed]);
}

/** The circuit's input for a position. Amounts above 80 bits are refused: the circuit would read them cut short. */
export function riskInput(p: RiskPosition): Hex {
  for (const [name, v] of [
    ["debt", p.debt],
    ["value", p.value],
  ] as const) {
    if (v < 0n || v > MAX_RISK_AMOUNT) throw new RangeError(`${name} must fit in ${RISK_AMOUNT_BITS} bits`);
  }
  return packBits([...toBits(p.debt, RISK_AMOUNT_BITS), ...toBits(p.value, RISK_AMOUNT_BITS), ...toBits(SESSION_CODE(p.session), RISK_SESSION_BITS), p.preClose]);
}

export function readRisk(bits: readonly boolean[]): RiskReading {
  return { healthy: !!bits[0], closedRegime: !!bits[1], belowSoft: !!bits[2], belowSoftOpen: !!bits[3], belowSoftClosed: !!bits[4] };
}

export const readRiskOutput = (out: Hex) => readRisk(unpackBits(out, 5));

/** The same answer from `math.ts` and the `RiskManager` rules: the reference the circuit is tested against. */
export function riskAt(limits: RiskLimits, p: RiskPosition): RiskReading {
  // positionLtvWad takes collateral and a Morpho price; a price of 1e36 makes the value the collateral itself.
  const ltv = positionLtvWad(p.debt, p.value, ORACLE_PRICE_SCALE);
  const softOpen = limits.softOpenWad ?? limits.lltvWad;
  const softClosed = limits.softClosedWad ?? limits.lltvWad;
  const closedRegime = p.preClose || p.session === "CLOSED" || p.session === "UNKNOWN";
  return {
    healthy: ltv <= limits.lltvWad,
    closedRegime,
    belowSoft: ltv <= (closedRegime ? softClosed : softOpen),
    belowSoftOpen: ltv <= softOpen,
    belowSoftClosed: ltv <= softClosed,
  };
}
