import type { SwapSource } from "@levra/kyber";
import { describe, expect, it } from "vitest";
import { midPriceE8 } from "../src/quotes/common";

const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const QQQ = "0x1446501E886c7f830DB9b494A1890cBCCC072f57";
const HOOD = "0x2222222222222222222222222222222222222222";

function countingSwap() {
  let calls = 0;
  const swap: SwapSource = {
    async price({ tokenIn, amountIn }) {
      calls++;
      // 1 stock = 750 USDC both ways: USDC has 6 decimals, the stock 18.
      return tokenIn === USDC ? (amountIn * 10n ** 18n) / 750_000_000n : (amountIn * 750_000_000n) / 10n ** 18n;
    },
    async quote() {
      throw new Error("not used");
    },
  };
  return { swap, calls: () => calls };
}

describe("DEX mid price for quotes", () => {
  it("measures each stock once and shares it between quotes", async () => {
    const { swap, calls } = countingSwap();
    const first = await midPriceE8(swap, USDC, QQQ, 6, 18, 75_000_000_000n);
    const second = await midPriceE8(swap, USDC, QQQ, 6, 18, 75_100_000_000n);
    expect(first > 74_990_000_000n && first <= 75_000_000_000n).toBe(true);
    expect(second).toBe(first);
    expect(calls()).toBe(2);

    await midPriceE8(swap, USDC, HOOD, 6, 18, 75_000_000_000n);
    expect(calls()).toBe(4);
  });

  it("keeps one cache per swap source", async () => {
    const a = countingSwap();
    const b = countingSwap();
    await midPriceE8(a.swap, USDC, QQQ, 6, 18, 75_000_000_000n);
    await midPriceE8(b.swap, USDC, QQQ, 6, 18, 75_000_000_000n);
    expect([a.calls(), b.calls()]).toEqual([2, 2]);
  });
});
