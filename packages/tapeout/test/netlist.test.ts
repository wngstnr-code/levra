import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { CircuitBuilder, encodeNetlist, endpointId, lessThan, packBits, simulate, toBits, unpackBits } from "../src";

describe("netlist wire format", () => {
  it("encodes NAND, LATCH and REF elements", () => {
    const cpu = getAddress("0x00000000000000000000000000000000000000aa");
    expect(encodeNetlist([{ op: "nand", a: 2, b: 3 }])).toBe("0x00000002000003");
    expect(encodeNetlist([{ op: "latch", d: 5 }])).toBe("0x01000005");
    expect(encodeNetlist([{ op: "ref", cpu, id: 7n, ins: [2, 3], nOut: 1 }])).toBe(`0x02${cpu.slice(2).toLowerCase()}00000000000000070201000002000003`);
  });

  it("refuses a gate that reads its own output or a later signal", () => {
    const c = new CircuitBuilder(1);
    expect(() => c.nand(2, 3)).toThrow(/earlier signals/);
  });

  it("packs bits LSB first per byte, as eval reads them", () => {
    // TapeOut's half adder answers 0x02 to 0x03 (05): sum 0, carry 1.
    expect(packBits([true, true])).toBe("0x03");
    expect(unpackBits("0x02", 2)).toEqual([false, true]);
    expect(packBits(toBits(0x1234n, 16))).toBe("0x3412");
    expect(packBits([])).toBe("0x00");
  });

  it("builds a TapeSend endpoint from the chain and the container", () => {
    const container = getAddress("0x00000000000000000000000000000000000000bb");
    // 4 zero bytes, the chain id in 8 bytes, the container in 20.
    expect(endpointId(196, container)).toBe(`0x${"0".repeat(22)}c4${"0".repeat(38)}bb`);
  });
});

describe("a < b circuit", () => {
  it("costs 7 NAND per bit and ends on its output", () => {
    const c = lessThan(8);
    expect(c.gates).toHaveLength(56);
    expect(c).toMatchObject({ nIn: 16, nOut: 1 });
  });

  it("matches a < b for every pair of 6-bit numbers", () => {
    const width = 6;
    const c = lessThan(width);
    for (let a = 0n; a < 64n; a++) {
      for (let b = 0n; b < 64n; b++) {
        expect(simulate(c.gates, c.nIn, c.nOut, [...toBits(a, width), ...toBits(b, width)])).toEqual([a < b]);
      }
    }
  });

  it("copies an output that is not the last signal", () => {
    const c = new CircuitBuilder(2);
    const x = c.nand(c.input(0), c.input(1));
    c.not(x);
    const done = c.finish([x]);
    expect(done.gates).toHaveLength(4);
    expect(simulate(done.gates, 2, 1, [true, true])).toEqual([false]);
  });
});
