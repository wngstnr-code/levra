import type { DeployedMarket } from "@levra/shared/deployments";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { closeReceipt, receiptKey } from "../src/receipts/job";

const market: DeployedMarket = {
  symbol: "NVDA",
  side: "long",
  marketId: `0x${"aa".repeat(32)}`,
  oracle: "0x0000000000000000000000000000000000000001",
  collateralToken: "0x0000000000000000000000000000000000000002",
  loanToken: "0x0000000000000000000000000000000000000003",
  lltv: "625000000000000000",
};
const txHash: Hex = `0x${"12".repeat(32)}`;
const close = {
  marketId: market.marketId,
  side: "long" as const,
  txHash,
  logIndex: 4,
  blockTime: 1_795_604_400,
  sold: 2n * 10n ** 18n,
  returned: 90_000_000n,
  exitPriceE8: 18_512_345_678n,
  reason: 0,
  // 2 shares bought for 300 USDC: entry $150.
  before: { shares: 2n * 10n ** 18n, buyCost: 300_000_000n, invested: 75_000_000n, realized: 0n },
  marginOut: 75_000_000n,
  realized: 15_000_000n,
};

describe("close receipts (BE-84)", () => {
  it("reads on its own and carries the same facts for the app", () => {
    const r = closeReceipt(close, market, { usdc: 6, stock: 18 }, 196);
    expect(r.subject).toBe("NVDA long closed: +20.00%");
    expect(r.body).toBe(
      [
        "NVDA long closed on X Layer. Closed by you.",
        "Entry: $150",
        "Exit: $185.12345678",
        "Profit or loss: $15.00 (+20.00% of the margin)",
        `Transaction: ${txHash}`,
      ].join("\n"),
    );
    expect(r.ts).toBe(1_795_604_400_000);
    expect(r.levra).toEqual({
      type: "close",
      chainId: 196,
      marketId: market.marketId,
      symbol: "NVDA",
      side: "long",
      entryPriceE8: "15000000000",
      exitPriceE8: "18512345678",
      realizedUsdRaw: "15000000",
      marginUsdRaw: "75000000",
      pnlBps: 2000,
      reason: 0,
      txHash,
    });
  });

  it("says when protection closed it, shows a loss, and has no percent or entry without router margin", () => {
    const loss = closeReceipt({ ...close, reason: 1, realized: -7_500_000n }, market, { usdc: 6, stock: 18 }, 143);
    expect(loss.subject).toBe("NVDA long closed: -10.00%");
    expect(loss.body).toContain("closed on Monad. Closed by protection before the market close.");
    expect(loss.body).toContain("Profit or loss: -$7.50 (-10.00% of the margin)");

    const outside = closeReceipt({ ...close, before: { shares: 0n, buyCost: 0n, invested: 0n, realized: 0n }, marginOut: 0n, realized: 90_000_000n }, market, { usdc: 6, stock: 18 }, 8453);
    expect(outside.subject).toBe("NVDA long closed: $90.00");
    expect(outside.body).toContain("Entry: not known (opened outside Levra)");
    expect(outside.levra?.pnlBps).toBeNull();
  });

  it("keys a receipt by chain, transaction and log, so each close is queued once", () => {
    expect(receiptKey(196, { txHash: `0x${"AB".repeat(32)}`, logIndex: 7 })).toBe(`196:close:0x${"ab".repeat(32)}:7`);
  });
});
