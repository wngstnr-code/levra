import { CLOCK_SESSIONS } from "../src/clock";
import { ORACLE_PRICE_SCALE, WAD, collateralValue, morphoIsHealthy, morphoOraclePrice } from "@levra/shared/math";
import { describe, expect, it } from "vitest";
import {
  CircuitBuilder,
  Logic,
  MAX_RISK_AMOUNT,
  RISK_AMOUNT_BITS,
  compileNand,
  nonAdjacentForm,
  packBits,
  readRisk,
  riskAt,
  riskCircuit,
  riskInput,
  toBits,
  unpackBits,
  type RiskLimits,
  type RiskPosition,
} from "../src";

const pct = (bps: bigint) => (bps * WAD) / 10_000n;
/** The limits in 04 (Monad), the Base and X Layer proposals use the same shapes, and plain Morpho LLTVs. */
const LIMITS: Record<string, RiskLimits> = {
  aBIL: { lltvWad: pct(9150n), softOpenWad: pct(9000n), softClosedWad: pct(9000n) },
  aQQQ: { lltvWad: pct(7700n), softOpenWad: pct(7300n), softClosedWad: pct(7000n) },
  aHOOD: { lltvWad: pct(6250n), softOpenWad: pct(5800n), softClosedWad: pct(5000n) },
  "Morpho 38.5%": { lltvWad: pct(3850n) },
  "Morpho 62.5%": { lltvWad: pct(6250n) },
  "Morpho 86%": { lltvWad: pct(8600n) },
  "Morpho 98%": { lltvWad: pct(9800n) },
};

/** A small fixed PRNG, so a failure can be replayed. */
function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const bits = (n: number) => {
    let v = 0n;
    for (let i = 0; i < n; i += 30) v = (v << 30n) | BigInt(Math.floor(next() * 2 ** 30));
    return v & ((1n << BigInt(n)) - 1n);
  };
  return { next, bits, pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]! };
}

const SESSIONS = CLOCK_SESSIONS;

function circuitFor(limits: RiskLimits) {
  const circuit = riskCircuit(limits);
  const run = compileNand(circuit.gates, circuit.nIn, circuit.nOut);
  return { circuit, at: (p: RiskPosition) => readRisk(run(unpackBits(riskInput(p), circuit.nIn))) };
}

describe("word helpers for the risk circuit", () => {
  it("writes constants as non-adjacent signed digits", () => {
    for (let k = 1n; k < 5000n; k++) {
      const d = nonAdjacentForm(k);
      expect(d.reduce((sum, x, i) => sum + BigInt(x) * (1n << BigInt(i)), 0n)).toBe(k);
      for (let i = 1; i < d.length; i++) expect(d[i] !== 0 && d[i - 1] !== 0).toBe(false);
      expect(d.at(-1)).toBe(1);
    }
  });

  it("multiplies by a constant and compares exactly", () => {
    const r = prng(7);
    for (const k of [1n, 2n, 3n, 7n, 15n, 77n, 100n, 183n, 1000n, 10_000n, 65_535n]) {
      const c = new CircuitBuilder(24);
      const g = new Logic(c);
      const x = Array.from({ length: 12 }, (_, i) => c.input(i));
      const y = Array.from({ length: 12 }, (_, i) => c.input(12 + i));
      const product = g.mulConst(x, k);
      const out = c.finish([...product, g.le(x, y), g.le(product, y)]);
      const run = compileNand(out.gates, out.nIn, out.nOut);
      for (let i = 0; i < 300; i++) {
        const [a, b] = i < 4 ? [[0n, 0n], [4095n, 4095n], [4095n, 0n], [0n, 4095n]][i]! : [r.bits(12), r.bits(12)];
        const bits = run([...toBits(a!, 12), ...toBits(b!, 12)]);
        const got = bits.slice(0, product.length).reduce((v, bit, j) => (bit ? v | (1n << BigInt(j)) : v), 0n);
        expect(got, `${a} * ${k}`).toBe(a! * k);
        expect(bits[product.length], `${a} <= ${b}`).toBe(a! <= b!);
        expect(bits[product.length + 1], `${a} * ${k} <= ${b}`).toBe(a! * k <= b!);
      }
    }
  });
});

describe("risk circuit (BE-83)", () => {
  it("is small enough to tape out and eval on X Layer for every limit in 04", () => {
    for (const [name, limits] of Object.entries(LIMITS)) {
      const n = riskCircuit(limits).gates.length;
      console.log(`risk ${name}: ${n} NAND`);
      // About 2,300 to 2,500 gas per gate to eval (05, measured on the clock): under 25 million for 10,000 gates.
      expect(n, name).toBeLessThan(10_000);
    }
  });

  it("refuses limits outside (0, 1] and amounts that do not fit in 80 bits", () => {
    expect(() => riskCircuit({ lltvWad: 0n })).toThrow();
    expect(() => riskCircuit({ lltvWad: WAD + 1n })).toThrow();
    expect(() => riskInput({ debt: MAX_RISK_AMOUNT + 1n, value: 1n, session: "REGULAR", preClose: false })).toThrow(/80 bits/);
    expect(() => riskInput({ debt: 1n, value: -1n, session: "REGULAR", preClose: false })).toThrow(/80 bits/);
  });

  for (const [name, limits] of Object.entries(LIMITS)) {
    it(`matches math.ts and the RiskManager rules for ${name}`, () => {
      const { at } = circuitFor(limits);
      const r = prng(name.length * 97 + 13);
      const check = (p: RiskPosition) => {
        const got = at(p);
        const want = riskAt(limits, p);
        if (JSON.stringify(got) !== JSON.stringify(want)) expect({ ...p, ...got }).toEqual({ ...p, ...want });
      };
      const thresholds = [limits.lltvWad, limits.softOpenWad ?? limits.lltvWad, limits.softClosedWad ?? limits.lltvWad];
      const fixed: [bigint, bigint][] = [
        [0n, 0n],
        [0n, MAX_RISK_AMOUNT],
        [1n, 0n],
        [MAX_RISK_AMOUNT, 0n],
        [MAX_RISK_AMOUNT, MAX_RISK_AMOUNT],
        [1n, 1n],
      ];
      for (let i = 0; i < 2_000; i++) {
        const session = r.pick(SESSIONS);
        const preClose = r.next() < 0.3;
        let debt: bigint;
        let value: bigint;
        if (i < fixed.length) [debt, value] = fixed[i]!;
        else if (i % 2 === 0) {
          // Exactly on a limit and one unit either side: debt * WAD = T * value is where rounding would show.
          value = r.bits(1 + Math.floor(r.next() * RISK_AMOUNT_BITS));
          const t = r.pick(thresholds);
          debt = (t * value) / WAD + BigInt(Math.floor(r.next() * 3) - 1);
          if (debt < 0n) debt = 0n;
        } else {
          const size = 1 + Math.floor(r.next() * RISK_AMOUNT_BITS);
          value = r.bits(size);
          debt = r.bits(Math.max(1, size - Math.floor(r.next() * 4)));
        }
        check({ debt, value, session, preClose });
      }
    });
  }

  it("says healthy exactly when Morpho does, at real oracle prices", () => {
    const limits = LIMITS.aQQQ!;
    const { at } = circuitFor(limits);
    const r = prng(42);
    for (let i = 0; i < 1_500; i++) {
      // A long on an 18 decimal stock against 6 decimal USDC, at prices from $1 to $2,000.
      const price = morphoOraclePrice("long", BigInt(1 + Math.floor(r.next() * 2_000)) * 10n ** 8n + r.bits(20), 18, 6);
      const collateral = r.bits(60 + Math.floor(r.next() * 14));
      const value = collateralValue(collateral, price);
      const healthyDebt = (value * limits.lltvWad) / WAD;
      const debt = healthyDebt + BigInt(Math.floor(r.next() * 5) - 2);
      if (debt < 0n || value > MAX_RISK_AMOUNT || debt > MAX_RISK_AMOUNT) continue;
      // Empty totals: borrow shares of debt * 1e6 are worth exactly `debt` once rounded up.
      const morpho = morphoIsHealthy({ collateral, borrowShares: debt * 1_000_000n }, { totalBorrowAssets: 0n, totalBorrowShares: 0n }, price, limits.lltvWad);
      expect(at({ debt, value, session: "REGULAR", preClose: false }).healthy, `debt ${debt}, value ${value}`).toBe(morpho);
    }
    expect(ORACLE_PRICE_SCALE).toBe(10n ** 36n);
  });

  it("uses the closed soft limit when the session is CLOSED or UNKNOWN, in the pre-close window, or for no session", () => {
    const limits = LIMITS.aQQQ!;
    const { circuit } = circuitFor(limits);
    const run = compileNand(circuit.gates, circuit.nIn, circuit.nOut);
    // 71.5%: under the open limit (73%), over the closed one (70%).
    const debt = 715n;
    const value = 1_000n;
    for (let code = 0; code < 8; code++) {
      for (const preClose of [false, true]) {
        const bits = unpackBits(packBits([...toBits(debt, 80), ...toBits(value, 80), ...toBits(BigInt(code), 3), preClose]), circuit.nIn);
        const got = readRisk(run(bits));
        const closed = preClose || code === 0 || code >= 5;
        expect(got, `session code ${code}, pre-close ${preClose}`).toEqual({ healthy: true, closedRegime: closed, belowSoft: !closed, belowSoftOpen: true, belowSoftClosed: false });
      }
    }
  });
});
