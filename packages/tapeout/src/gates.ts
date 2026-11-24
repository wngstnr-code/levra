import { CONST0, CONST1, type CircuitBuilder } from "./netlist";

/** An unsigned number as signals, LSB first. */
export type Word = number[];

/**
 * Word-level logic on top of NAND gates. Constants fold away and each signal's NOT is made once, so a comparison or an
 * addition with a constant costs only the gates it needs.
 */
export class Logic {
  private readonly nots = new Map<number, number>();
  constructor(readonly c: CircuitBuilder) {}

  not(a: number): number {
    if (a === CONST0) return CONST1;
    if (a === CONST1) return CONST0;
    let n = this.nots.get(a);
    if (n === undefined) {
      n = this.c.nand(a, a);
      this.nots.set(a, n);
      this.nots.set(n, a);
    }
    return n;
  }

  and(a: number, b: number): number {
    if (a === CONST0 || b === CONST0) return CONST0;
    if (a === CONST1) return b;
    if (b === CONST1 || a === b) return a;
    return this.not(this.c.nand(a, b));
  }

  or(a: number, b: number): number {
    if (a === CONST1 || b === CONST1) return CONST1;
    if (a === CONST0) return b;
    if (b === CONST0 || a === b) return a;
    return this.c.nand(this.not(a), this.not(b));
  }

  xor(a: number, b: number): number {
    if (a === CONST0) return b;
    if (b === CONST0) return a;
    if (a === CONST1) return this.not(b);
    if (b === CONST1) return this.not(a);
    const t = this.c.nand(a, b);
    return this.c.nand(this.c.nand(a, t), this.c.nand(b, t));
  }

  mux(sel: number, ifOne: number, ifZero: number): number {
    if (ifOne === ifZero) return ifOne;
    return this.or(this.and(sel, ifOne), this.and(this.not(sel), ifZero));
  }

  all(xs: readonly number[]): number {
    return tree(xs, CONST1, (a, b) => this.and(a, b));
  }

  any(xs: readonly number[]): number {
    return tree(xs, CONST0, (a, b) => this.or(a, b));
  }

  majority(a: number, b: number, c: number): number {
    return this.or(this.or(this.and(a, b), this.and(a, c)), this.and(b, c));
  }

  /** `x == value`. */
  eqConst(x: Word, value: bigint): number {
    if (value >> BigInt(x.length) !== 0n) return CONST0;
    return this.all(x.map((s, i) => (((value >> BigInt(i)) & 1n) === 1n ? s : this.not(s))));
  }

  /** `x < value`, unsigned. */
  ltConst(x: Word, value: bigint): number {
    if (value >> BigInt(x.length) !== 0n) return CONST1;
    let below = CONST0;
    x.forEach((s, i) => {
      below = ((value >> BigInt(i)) & 1n) === 1n ? this.or(this.not(s), below) : this.and(this.not(s), below);
    });
    return below;
  }

  /** `x >= value`, unsigned. */
  geConst(x: Word, value: bigint): number {
    return this.not(this.ltConst(x, value));
  }

  /** `a + b` over `width` bits, and the carry out. */
  add(a: Word, b: Word, width: number, carryIn: number = CONST0): { sum: Word; carry: number } {
    const sum: Word = [];
    let carry = carryIn;
    for (let i = 0; i < width; i++) {
      const x = a[i] ?? CONST0;
      const y = b[i] ?? CONST0;
      const xy = this.xor(x, y);
      sum.push(this.xor(xy, carry));
      carry = this.or(this.and(x, y), this.and(xy, carry));
    }
    return { sum, carry };
  }

  constant(value: bigint, width: number): Word {
    return Array.from({ length: width }, (_, i) => (((value >> BigInt(i)) & 1n) === 1n ? CONST1 : CONST0));
  }

  muxWord(sel: number, ifOne: Word, ifZero: Word): Word {
    return ifOne.map((s, i) => this.mux(sel, s, ifZero[i] ?? CONST0));
  }

  /**
   * `x * k` for a constant `k > 0`, over `x.length + bitLength(k)` bits, which always holds the product. Shift and add
   * on the signed digits of `k` (non-adjacent form), so a run of ones costs one subtraction instead of many additions.
   */
  mulConst(x: Word, k: bigint): Word {
    if (k <= 0n) throw new Error("mulConst needs a positive constant");
    const width = x.length + k.toString(2).length;
    const digits = nonAdjacentForm(k);
    const shifted = (s: number): Word => [...Array<number>(s).fill(CONST0), ...x].slice(0, width);
    let acc: Word | null = null;
    for (let s = digits.length - 1; s >= 0; s--) {
      const d = digits[s]!;
      if (d === 0) continue;
      const term = shifted(s);
      // The top digit of a non-adjacent form is +1, so the sum starts positive; wrapping in between is exact mod 2^width.
      if (acc === null) acc = [...term, ...Array<number>(width).fill(CONST0)].slice(0, width);
      else if (d > 0) acc = this.addTight(acc, term, width);
      else acc = this.addTight(acc, Array.from({ length: width }, (_, i) => this.not(term[i] ?? CONST0)), width, CONST1);
    }
    return acc!;
  }

  /**
   * `a + b` like `add`, with the 9 NAND full adder where no input is a constant (13 in `add`). `add` stays as it is
   * because the Wall Street Clock's measured size depends on it.
   */
  addTight(a: Word, b: Word, width: number, carryIn: number = CONST0): Word {
    const sum: Word = [];
    let carry = carryIn;
    for (let i = 0; i < width; i++) {
      const x = a[i] ?? CONST0;
      const y = b[i] ?? CONST0;
      if ([x, y, carry].some((s) => s === CONST0 || s === CONST1)) {
        const xy = this.xor(x, y);
        sum.push(this.xor(xy, carry));
        carry = this.or(this.and(x, y), this.and(xy, carry));
        continue;
      }
      const t1 = this.c.nand(x, y);
      const xy = this.c.nand(this.c.nand(x, t1), this.c.nand(y, t1));
      const t4 = this.c.nand(xy, carry);
      sum.push(this.c.nand(this.c.nand(xy, t4), this.c.nand(carry, t4)));
      carry = this.c.nand(t1, t4);
    }
    return sum;
  }

  /** At least two of three in 6 NAND where no input is a constant. */
  majorityTight(a: number, b: number, c: number): number {
    if ([a, b, c].some((s) => s === CONST0 || s === CONST1)) return this.majority(a, b, c);
    return this.c.nand(this.not(this.c.nand(this.c.nand(a, b), this.c.nand(a, c))), this.c.nand(b, c));
  }

  /** `a <= b`, unsigned, for words of any widths. */
  le(a: Word, b: Word): number {
    const width = Math.max(a.length, b.length);
    // "b is below a so far" from the low bit up: at each bit the majority of (not b_i, a_i, below).
    let below = CONST0;
    for (let i = 0; i < width; i++) below = this.majorityTight(this.not(b[i] ?? CONST0), a[i] ?? CONST0, below);
    return this.not(below);
  }
}

/** Signed digits of `k`, lowest first, no two adjacent digits non-zero. */
export function nonAdjacentForm(k: bigint): number[] {
  const digits: number[] = [];
  let n = k;
  while (n > 0n) {
    if ((n & 1n) === 1n) {
      const d = 2 - Number(n & 3n);
      digits.push(d);
      n -= BigInt(d);
    } else digits.push(0);
    n >>= 1n;
  }
  return digits;
}

function tree(xs: readonly number[], empty: number, op: (a: number, b: number) => number): number {
  if (xs.length === 0) return empty;
  let level = [...xs];
  while (level.length > 1) {
    const next: number[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? op(level[i]!, level[i + 1]!) : level[i]!);
    level = next;
  }
  return level[0]!;
}
