import type { HistoryItem, Position } from "@levra/shared/api";
import { describe, expect, it } from "vitest";
import { closedCardData, postOnXUrl, shareCardData } from "./shareCard";

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

describe("closed trade card", () => {
  const close = { id: "1", type: "close", marketId: `0x${"11".repeat(32)}`, symbol: "QQQ", side: "short", txHash: `0x${"22".repeat(32)}`, timestamp: 1, stockAmountRaw: "1", usdAmountRaw: "1", execPriceE8: "60000000000", feeRaw: "0", realizedPnlUsdRaw: "-1500000" } as HistoryItem;
  const labels = { exit: "Exit", closed: "Closed" };
  it("leads with the realized PnL and lists the exit price and day", () => {
    const d = closedCardData(close, "aQQQ", "Base", labels, "24 Nov")!;
    expect(d.moveUp).toBe(false);
    expect(d.moveText).toBe("−$1.50");
    expect(d.side).toBe("short");
    expect(d.stats).toEqual([["Exit", "$600.00"], ["Closed", "24 Nov"]]);
  });
  it("has no card without a realized PnL", () => {
    expect(closedCardData({ ...close, realizedPnlUsdRaw: null }, "aQQQ", "Base", labels, "x")).toBeNull();
  });
});
