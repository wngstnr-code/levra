import type { SwapSource } from "@levra/kyber";
import { BPS, MAX_UINT256, WAD, mulDiv } from "@levra/shared/math";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { inPreCloseWindow, planDeleverage, TARGET_BELOW_SOFT_WAD } from "../src/protector/protector";

const USDC: Address = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const STOCK: Address = "0x1446501E886c7f830DB9b494A1890cBCCC072f57";
const router: Address = "0x0000000000000000000000000000000000000001";
const PRICE_E8 = 60_000_000_000n; // $600
const pct = (n: bigint) => (n * WAD) / 100n;

/** A DEX at $600 that loses `impactBps` on every trade, both ways. */
function dex(impactBps: bigint): SwapSource {
  return {
    price: async () => 0n,
    quote: async ({ tokenIn, amountIn }) => {
      const out =
        tokenIn === STOCK
          ? mulDiv(amountIn * PRICE_E8, 10n ** 6n, 10n ** 8n * 10n ** 18n) // stock to USDC
          : mulDiv(amountIn * 10n ** 8n, 10n ** 18n, PRICE_E8 * 10n ** 6n); // USDC to stock
      return { amountIn, amountOut: (out * (BPS - impactBps)) / BPS, target: router, data: "0x" as Hex, gas: 0n } as never;
    },
  } as SwapSource;
}

const market = (side: "long" | "short") =>
  ({ symbol: "QQQ", side, marketId: `0x${"ab".repeat(32)}` as Hex, collateralToken: side === "long" ? STOCK : USDC, loanToken: side === "long" ? USDC : STOCK, oracle: router, lltv: "770000000000000000" }) as never;

describe("deleverage sizing (04)", () => {
  it("brings a long to the soft limit minus one point, after impact, fee and slippage", async () => {
    // 1 stock at $600, 420 USDC debt: LTV 70% against a soft limit of 60%.
    const position = { collateral: 10n ** 18n, debt: 420_000_000n, ltv: pct(70n), softLtv: pct(60n), borrowShares: 420_000_000n * 1_000_000n };
    const plan = await planDeleverage({ market: market("long"), position, swap: dex(150n), router, keeperFeeBps: 30n, slippageBps: 100n });
    const target = pct(60n) - TARGET_BELOW_SOFT_WAD;
    expect(plan.expectedLtvWad <= target).toBe(true);
    // Sized from the real cost, so it does not sell much more than needed.
    expect(plan.expectedLtvWad > target - pct(1n)).toBe(true);
    expect(plan.params.withdrawAssets).toBe(plan.params.swapAmountIn);
    expect(plan.params.repayShares < position.borrowShares).toBe(true);
    // The router must be able to repay from the worst-case proceeds less the keeper fee.
    const repaid = mulDiv(position.debt, plan.params.repayShares, position.borrowShares, "ceil");
    expect(repaid <= plan.params.swap.minOut - (plan.params.swap.minOut * 30n) / BPS).toBe(true);
  });

  it("closes a long fully when selling everything is the only way to the target", async () => {
    // At 99% the selling cost alone keeps the formula above the whole position.
    const position = { collateral: 10n ** 18n, debt: 594_000_000n, ltv: pct(99n), softLtv: pct(60n), borrowShares: 594_000_000n * 1_000_000n };
    const plan = await planDeleverage({ market: market("long"), position, swap: dex(150n), router, keeperFeeBps: 30n, slippageBps: 100n });
    expect(plan.params).toMatchObject({ repayShares: MAX_UINT256, withdrawAssets: MAX_UINT256, swapAmountIn: MAX_UINT256 });
  });

  it("brings a short to the target by spending part of the USDC collateral, with the fee on top", async () => {
    // 1,000 USDC collateral, 1.1 stock owed at $600 = $660: LTV 66% against a soft limit of 55%.
    const position = { collateral: 1_000_000_000n, debt: 11n * 10n ** 17n, ltv: pct(66n), softLtv: pct(55n), borrowShares: 11n * 10n ** 23n };
    const plan = await planDeleverage({ market: market("short"), position, swap: dex(150n), router, keeperFeeBps: 30n, slippageBps: 100n });
    const target = pct(55n) - TARGET_BELOW_SOFT_WAD;
    expect(plan.expectedLtvWad <= target).toBe(true);
    expect(plan.expectedLtvWad > target - pct(1n)).toBe(true);
    expect(plan.params.withdrawAssets).toBe(plan.params.swapAmountIn + mulDiv(plan.params.swapAmountIn, 30n, BPS, "ceil"));
    const repaid = mulDiv(position.debt, plan.params.repayShares, position.borrowShares, "ceil");
    expect(repaid <= plan.params.swap.minOut).toBe(true);
  });

  it("acts only in the 30 minutes before the close", () => {
    const close = 1_800_000_000;
    expect(inPreCloseWindow(close - 1_801, close)).toBe(false);
    expect(inPreCloseWindow(close - 1_800, close)).toBe(true);
    expect(inPreCloseWindow(close - 1, close)).toBe(true);
    expect(inPreCloseWindow(close, close)).toBe(false);
  });
});
