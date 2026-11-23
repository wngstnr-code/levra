import { Attribution } from "ox/erc8021";
import { describe, expect, it } from "vitest";
import { builderCodeSuffix, withBuilderCode } from "./attribution";

describe("Base Builder Codes (BE-74)", () => {
  it("writes the same ERC-8021 schema 0 suffix as ox, which Base reads back", () => {
    for (const codes of [["bc_b7k3p9da"], ["baseapp"], ["bc_one", "bc_two"]]) {
      const suffix = builderCodeSuffix(codes);
      expect(suffix).toBe(Attribution.toDataSuffix({ codes }));
      expect(Attribution.fromData(`0xa9059cbb${suffix.slice(2)}`)).toEqual({ codes, id: 0 });
    }
  });

  it("appends the code only on a chain that has one", () => {
    const codes = { 8453: "bc_b7k3p9da" };
    expect(withBuilderCode(8453, "0xa9059cbb", codes)).toBe(`0xa9059cbb${builderCodeSuffix(["bc_b7k3p9da"]).slice(2)}`);
    expect(withBuilderCode(143, "0xa9059cbb", codes)).toBe("0xa9059cbb");
    expect(withBuilderCode(8453, "0xa9059cbb", {})).toBe("0xa9059cbb");
  });

  it("carries Levra's code on Base only", () => {
    expect(Attribution.fromData(withBuilderCode(8453, "0xa9059cbb"))).toEqual({ codes: ["bc_1w63m4n4"], id: 0 });
    expect(withBuilderCode(143, "0xa9059cbb")).toBe("0xa9059cbb");
    expect(withBuilderCode(196, "0xa9059cbb")).toBe("0xa9059cbb");
  });

  it("refuses a code that would break the format", () => {
    expect(() => builderCodeSuffix([])).toThrow();
    expect(() => builderCodeSuffix(["bc,x"])).toThrow();
    expect(() => builderCodeSuffix(["bc x"])).toThrow();
    expect(() => builderCodeSuffix(["é"])).toThrow();
    expect(() => builderCodeSuffix(["x".repeat(256)])).toThrow(/255/);
  });
});
