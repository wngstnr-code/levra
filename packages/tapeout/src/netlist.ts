import { concatHex, numberToHex, type Address, type Hex } from "viem";

/**
 * TapeOut netlists (wire format of the circuits contract): NAND `00 a:u24 b:u24`, LATCH `01 d:u24`,
 * REF `02 cpu:20B id:u64 nIns:u8 nOut:u8 ins:u24*nIns`. Signal 0 is const0, 1 is const1, inputs are 2..1+nIn, then each
 * element appends its outputs. The circuit's outputs are the last nOut signals produced by elements.
 */
export type Gate =
  | { op: "nand"; a: number; b: number }
  | { op: "latch"; d: number }
  | { op: "ref"; cpu: Address; id: bigint; ins: number[]; nOut: number };

export const CONST0 = 0;
export const CONST1 = 1;
const MAX_SIGNAL = 2 ** 24 - 1;

const u24 = (n: number) => {
  if (!Number.isInteger(n) || n < 0 || n > MAX_SIGNAL) throw new Error(`signal ${n} does not fit in 24 bits`);
  return numberToHex(n, { size: 3 });
};

export function encodeNetlist(gates: readonly Gate[]): Hex {
  return concatHex(
    gates.map((g) => {
      if (g.op === "nand") return concatHex(["0x00", u24(g.a), u24(g.b)]);
      if (g.op === "latch") return concatHex(["0x01", u24(g.d)]);
      return concatHex(["0x02", g.cpu.toLowerCase() as Hex, numberToHex(g.id, { size: 8 }), numberToHex(g.ins.length, { size: 1 }), numberToHex(g.nOut, { size: 1 }), ...g.ins.map(u24)]);
    }),
  );
}

/** A combinational circuit made of NAND gates only. */
export class CircuitBuilder {
  readonly gates: Gate[] = [];
  constructor(readonly nIn: number) {}

  input(i: number): number {
    if (i < 0 || i >= this.nIn) throw new Error(`input ${i} out of range`);
    return 2 + i;
  }

  private get next(): number {
    return 2 + this.nIn + this.gates.length;
  }

  nand(a: number, b: number): number {
    if (a >= this.next || b >= this.next) throw new Error("a gate can only read earlier signals");
    this.gates.push({ op: "nand", a, b });
    return this.next - 1;
  }

  not(a: number): number {
    return this.nand(a, a);
  }

  and(a: number, b: number): number {
    return this.not(this.nand(a, b));
  }

  or(a: number, b: number): number {
    return this.nand(this.not(a), this.not(b));
  }

  /** At least two of three. */
  majority(a: number, b: number, c: number): number {
    const ab = this.nand(a, b);
    const ac = this.nand(a, c);
    const bc = this.nand(b, c);
    return this.nand(this.not(this.nand(ab, ac)), bc);
  }

  /** The outputs must be the last signals, in order; a copy (two NAND) is added for each one that is not. */
  finish(outputs: readonly number[]): { gates: Gate[]; nIn: number; nOut: number; netlist: Hex } {
    if (outputs.length === 0) throw new Error("a circuit needs at least one output");
    const last = this.next - outputs.length;
    const inPlace = last >= 2 + this.nIn && outputs.every((s, i) => s === last + i);
    if (!inPlace) {
      const copies = outputs.map((s) => this.not(s));
      for (const c of copies) this.not(c);
    }
    return { gates: this.gates, nIn: this.nIn, nOut: outputs.length, netlist: encodeNetlist(this.gates) };
  }
}

/** Runs a NAND-only circuit locally, the way `eval` does onchain. */
export function simulate(gates: readonly Gate[], nIn: number, nOut: number, inputs: readonly boolean[]): boolean[] {
  const s: boolean[] = [false, true];
  for (let i = 0; i < nIn; i++) s.push(inputs[i] ?? false);
  for (const g of gates) {
    if (g.op !== "nand") throw new Error("simulate runs NAND-only circuits");
    s.push(!(s[g.a]! && s[g.b]!));
  }
  return s.slice(s.length - nOut);
}

/** Inputs, outputs and state are packed LSB first in each byte: bit i is (byte[i >> 3] >> (i & 7)) & 1. */
export function packBits(bits: readonly boolean[]): Hex {
  const bytes = new Uint8Array(Math.max(1, Math.ceil(bits.length / 8)));
  bits.forEach((b, i) => {
    if (b) bytes[i >> 3]! |= 1 << (i & 7);
  });
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

export function unpackBits(data: Hex, n: number): boolean[] {
  const bytes = Buffer.from(data.slice(2), "hex");
  return Array.from({ length: n }, (_, i) => (((bytes[i >> 3] ?? 0) >> (i & 7)) & 1) === 1);
}

export const toBits = (value: bigint, width: number): boolean[] => Array.from({ length: width }, (_, i) => ((value >> BigInt(i)) & 1n) === 1n);

/**
 * `a < b` for two unsigned numbers of `width` bits, inputs a then b, LSB first. Each bit carries "a is below b so far"
 * as the majority of (not a_i, b_i, carry): 7 NAND per bit.
 */
export function lessThan(width: number) {
  const c = new CircuitBuilder(2 * width);
  let below = CONST0;
  for (let i = 0; i < width; i++) below = c.majority(c.not(c.input(i)), c.input(width + i), below);
  return c.finish([below]);
}
