import { describe, expect, it } from "vitest";
import { maxLtvWithAccrual } from "../src/quotes/common";

describe("maxLtv sent with an open quote", () => {
  it("adds 1 bps of the LTV for interest accrued before the block, rounded up", () => {
    expect(maxLtvWithAccrual(700_000_000_000_000_000n)).toBe(700_070_000_000_000_000n);
    expect(maxLtvWithAccrual(1n)).toBe(2n);
    expect(maxLtvWithAccrual(0n)).toBe(0n);
  });
});