import { describe, expect, it } from "vitest";
import { decideMaxOracleAge } from "../src/oracle/age-poster";

const ok = (value: number) => ({ value, reason: null });

describe("maxOracleAge decision", () => {
  it("posts the proposal when it moves the value by 10% or more", () => {
    expect(decideMaxOracleAge({ proposal: ok(2_100), current: 2_700, min: 1_500, cap: 3_600 })).toMatchObject({ action: "post", value: 2_100 });
  });

  it("skips a change under 10%", () => {
    expect(decideMaxOracleAge({ proposal: ok(2_500), current: 2_700, min: 1_500, cap: 3_600 })).toMatchObject({ action: "skip" });
  });

  it("keeps the value inside the owner's bounds", () => {
    expect(decideMaxOracleAge({ proposal: ok(9_000), current: 2_700, min: 1_500, cap: 3_600 })).toMatchObject({ action: "post", value: 3_600 });
    expect(decideMaxOracleAge({ proposal: ok(600), current: 2_700, min: 1_500, cap: 3_600 })).toMatchObject({ action: "post", value: 1_500 });
  });

  it("does nothing without bounds or without enough data", () => {
    expect(decideMaxOracleAge({ proposal: ok(2_100), current: 2_700, min: 0, cap: 0 })).toMatchObject({ action: "skip" });
    expect(decideMaxOracleAge({ proposal: { value: null, reason: "no full weekend observed" }, current: 2_700, min: 1_500, cap: 3_600 })).toEqual({
      action: "skip",
      reason: "no full weekend observed",
    });
  });
});
