import type { Position } from "@levra/shared/api";
import { describe, expect, it } from "vitest";
import { postOnXUrl, shareCardData } from "./shareCard";

const base = {
  marketId: `0x${"11".repeat(32)}`,
  symbol: "QQQ",
  side: "long",
  stockAmountRaw: "1",
  collateralRaw: "1",
  debtRaw: "1",
  valueUsdRaw: "1",
  equityUsdRaw: "1",
  entryPriceE8: "10000000000",
  oraclePriceE8: "11000000000",
  unrealizedPnlUsdRaw: "4200000",
  ltvWad: "0",
  softLtvWad: "0",
  lltvWad: "0",
  liqPriceE8: "0",
  liqDistanceBps: 0,
  protection: false,
  overSoftLimit: false,
  gapScenarios: [],
} as Position;

describe("share card", () => {
  it("shows a rise as a gain for a long", () => {
    const d = shareCardData(base, "aQQQ", "Monad");
    expect(d.moveUp).toBe(true);
    expect(d.moveText).toBe("+10%");
    expect(d.pnlText).toBe("+$4.20");
  });

  it("shows a rise as a loss for a short", () => {
    const d = shareCardData({ ...base, side: "short" }, "aQQQ", "Monad");
    expect(d.moveUp).toBe(false);
    expect(d.moveText).toBe("−10%");
  });

  it("builds an X post link", () => {
    expect(postOnXUrl("a b", "https://x.test/p")).toBe("https://x.com/intent/post?text=a%20b&url=https%3A%2F%2Fx.test%2Fp");
  });
});
