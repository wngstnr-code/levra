import { describe, expect, it } from "vitest";
import { formatAge, formatUnitsFixed, formatUsdE8, shortAddress } from "./format";

describe("formatUnitsFixed", () => {
  it("formats USDC base units", () => {
    expect(formatUnitsFixed(100_000_000n, 6, 2)).toBe("100.00");
    expect(formatUnitsFixed(1_234_567_891n, 6, 2)).toBe("1,234.56");
  });

  it("cuts extra digits instead of rounding up", () => {
    expect(formatUnitsFixed(999_999n, 6, 2)).toBe("0.99");
  });

  it("handles 18 decimals and zero fraction digits", () => {
    expect(formatUnitsFixed(1_500_000_000_000_000_000n, 18, 4)).toBe("1.5000");
    expect(formatUnitsFixed(1_500_000_000_000_000_000n, 18, 0)).toBe("1");
  });

  it("keeps the sign", () => {
    expect(formatUnitsFixed(-150n, 2, 2)).toBe("-1.50");
  });
});

describe("formatUsdE8", () => {
  it("formats an oracle price", () => {
    expect(formatUsdE8(74_562_000_000n)).toBe("$745.62");
  });
});

describe("formatAge", () => {
  it("picks the largest useful unit", () => {
    expect(formatAge(45)).toBe("45s");
    expect(formatAge(12 * 60 + 5)).toBe("12m");
    expect(formatAge(3 * 3600)).toBe("3h");
    expect(formatAge(3 * 3600 + 5 * 60)).toBe("3h 5m");
    expect(formatAge(2 * 86400 + 4 * 3600)).toBe("2d 4h");
    expect(formatAge(-3)).toBe("0s");
  });
});

describe("shortAddress", () => {
  it("keeps the start and the end", () => {
    expect(shortAddress("0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee")).toBe("0xD5D9…eAee");
  });
});
