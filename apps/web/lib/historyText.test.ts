import type { HistoryItem } from "@levra/shared/api";
import { describe, expect, it } from "vitest";
import { historySentence } from "./historyText";
import { en } from "./i18n/en";

const base: HistoryItem = {
  id: "1",
  type: "open",
  marketId: `0x${"11".repeat(32)}`,
  symbol: "QQQ",
  side: "long",
  txHash: `0x${"ab".repeat(32)}`,
  timestamp: 1791880000,
  stockAmountRaw: "269100000000000000",
  usdAmountRaw: "200000000",
  execPriceE8: "74320000000",
  feeRaw: "200000",
  realizedPnlUsdRaw: null,
};

describe("historySentence", () => {
  it("explains an open long with amount, price and fee", () => {
    expect(historySentence(base, en)).toBe("Bought 0.2691 aQQQ at $743.20 for $200.00. Fee $0.20.");
  });

  it("explains a liquidation", () => {
    const item = { ...base, type: "liquidation" as const, usdAmountRaw: "100000000", stockAmountRaw: "145000000000000000" };
    expect(historySentence(item, en)).toBe("Price hit the liquidation price. $100.00 of debt was repaid with 0.1450 aQQQ.");
  });

  it("explains a close with realized P&L", () => {
    const item = { ...base, type: "close" as const, usdAmountRaw: "49700000", realizedPnlUsdRaw: "420000" };
    expect(historySentence(item, en)).toBe("Closed. Got $49.70 back, +$0.42.");
  });
});
