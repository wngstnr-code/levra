import { describe, expect, it } from "vitest";
import { formatBps, formatDuration, formatLeverage, formatToken, formatTokenSigned, formatUsd, formatUsdSigned, formatWadPercent, parseAmount, wadRatio } from "./units";

describe("formatUsd", () => {
  it("formats USDC base units", () => {
    expect(formatUsd("100000000")).toBe("$100.00");
    expect(formatUsd(1_234_567_891n)).toBe("$1,234.56");
    expect(formatUsd("-290000")).toBe("−$0.29");
  });
  it("adds a plus sign for gains", () => {
    expect(formatUsdSigned("4200000")).toBe("+$4.20");
    expect(formatUsdSigned("0")).toBe("$0.00");
  });
});

describe("formatToken", () => {
  it("formats 18-decimal stock amounts", () => {
    expect(formatToken("269100000000000000", 18)).toBe("0.2691");
  });
});

describe("formatTokenSigned", () => {
  it("signs gains and losses", () => {
    expect(formatTokenSigned("2500000", 6, 2)).toBe("+2.50");
    expect(formatTokenSigned("-2500000", 6, 2)).toBe("−2.50");
    expect(formatTokenSigned("0", 6, 2)).toBe("0.00");
  });
});

describe("formatWadPercent", () => {
  it("drops trailing zero decimals", () => {
    expect(formatWadPercent("770000000000000000")).toBe("77%");
    expect(formatWadPercent("501000000000000000")).toBe("50.1%");
    expect(formatWadPercent("625000000000000000", 1)).toBe("62.5%");
  });
});

describe("formatBps", () => {
  it("formats signed basis points", () => {
    expect(formatBps(-260, { signed: true })).toBe("−2.6%");
    expect(formatBps(24, { signed: true })).toBe("+0.24%");
    expect(formatBps(50)).toBe("0.5%");
  });

  it("keeps the zeros of whole numbers", () => {
    expect(formatBps(10000, { fractionDigits: 0 })).toBe("100%");
    expect(formatBps(-1000, { signed: true, fractionDigits: 0 })).toBe("−10%");
    expect(formatBps(2000)).toBe("20%");
  });
});

describe("formatLeverage", () => {
  it("shows two decimals", () => {
    expect(formatLeverage(200)).toBe("2.00×");
    expect(formatLeverage(370)).toBe("3.70×");
  });
});

describe("parseAmount", () => {
  it("parses plain decimals into base units", () => {
    expect(parseAmount("100", 6)).toBe(100_000_000n);
    expect(parseAmount("0.5", 6)).toBe(500_000n);
    expect(parseAmount("1,000.25", 6)).toBe(1_000_250_000n);
  });
  it("rejects anything else", () => {
    expect(parseAmount("", 6)).toBeNull();
    expect(parseAmount("abc", 6)).toBeNull();
    expect(parseAmount("1.1234567", 6)).toBeNull();
    expect(parseAmount("-1", 6)).toBeNull();
  });
});

describe("wadRatio", () => {
  it("caps at one", () => {
    expect(wadRatio("501000000000000000", "770000000000000000")).toBeCloseTo(0.6506, 3);
    expect(wadRatio("900000000000000000", "770000000000000000")).toBe(1);
    expect(wadRatio("1", "0")).toBe(0);
  });
});

describe("formatDuration", () => {
  it("shows hours only when needed", () => {
    expect(formatDuration(3 * 3600 + 12 * 60 + 8)).toBe("3:12:08");
    expect(formatDuration(65)).toBe("1:05");
  });
});

describe("stockValueUsd", () => {
  it("values 0.2691 aQQQ at $741.45", async () => {
    const { stockValueUsd } = await import("./units");
    expect(stockValueUsd(269_100_000_000_000_000n, 74_145_000_000n, 18)).toBe(199_524_195n);
  });
});
