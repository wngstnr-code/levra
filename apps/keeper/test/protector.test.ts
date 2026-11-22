import type { SwapSource } from "@levra/swap";
import { marginRouterAbi } from "@levra/shared/abis";
import { BPS, WAD, mulDiv } from "@levra/shared/math";
import { ContractFunctionExecutionError, ContractFunctionRevertedError, encodeErrorResult, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { inPreCloseWindow, planDeleverage, refusedByBounds, TARGET_BELOW_SOFT_WAD, type DeleveragePlan, type KeeperBounds, type PlanResult } from "../src/protector/protector";

const USDC: Address = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const STOCK: Address = "0x1446501E886c7f830DB9b494A1890cBCCC072f57";
const router: Address = "0x0000000000000000000000000000000000000001";
const PRICE_E8 = 60_000_000_000n; // $600
const pct = (n: bigint) => (n * WAD) / 100n;
const FEE = 30n;
const SLIP = 100n;
const decimals = { quote: 6, stock: 18 };

/** A DEX at $600 that loses `impactBps` on every trade, both ways. A negative impact fills better than $600. */
function dex(impactBps: bigint): SwapSource {
  return {
    price: async () => 0n,
    quote: async ({ tokenIn, amountIn }) => {
      const out =
        tokenIn === STOCK
          ? mulDiv(amountIn * PRICE_E8, 10n ** 6n, 10n ** 8n * 10n ** 18n) // stock to USDC
          : mulDiv(amountIn * 10n ** 8n, 10n ** 18n, PRICE_E8 * 10n ** 6n); // USDC to stock
      return { amountIn, amountOut: (out * (BPS - impactBps)) / BPS, target: router, data: "0x" as Hex };
    },
  } as SwapSource;
}

const market = (side: "long" | "short") =>
  ({ symbol: "QQQ", side, marketId: `0x${"ab".repeat(32)}` as Hex, collateralToken: side === "long" ? STOCK : USDC, loanToken: side === "long" ? USDC : STOCK, oracle: router, lltv: "770000000000000000" }) as never;

/** Morpho prices at $600, scaled by 1e36: stock (18) to USDC (6) for a long, USDC to stock for a short. */
const MORPHO_PRICE = { long: 600n * 10n ** 24n, short: 10n ** 48n / 600n };
/** The router constants of D-91 and D-92, with a 2% deviation bound. */
const bounds = (side: "long" | "short"): KeeperBounds => ({ floorWad: pct(5n), sizeCostBps: 200n + FEE + 100n, morphoPrice: MORPHO_PRICE[side] });

// 1 stock at $600, 420 USDC debt: LTV 70% against a soft limit of 60%.
const long = { collateral: 10n ** 18n, debt: 420_000_000n, ltv: pct(70n), softLtv: pct(60n), borrowShares: 420_000_000n * 1_000_000n };
// 1,000 USDC collateral, 1.1 stock owed at $600 = $660: LTV 66% against a soft limit of 55%.
const short = { collateral: 1_000_000_000n, debt: 11n * 10n ** 17n, ltv: pct(66n), softLtv: pct(55n), borrowShares: 11n * 10n ** 23n };

function planOf(r: PlanResult): DeleveragePlan {
  if ("skip" in r) throw new Error(`skipped: ${r.skip}`);
  return r.plan;
}
const repaidOf = (position: { debt: bigint; borrowShares: bigint }, plan: DeleveragePlan) => mulDiv(position.debt, plan.params.repayShares, position.borrowShares);

/** `_checkKeeperSize` and the floor in `_checkReduced`, as the router computes them. */
function routerAccepts(side: "long" | "short", position: { debt: bigint; borrowShares: bigint; softLtv: bigint }, plan: DeleveragePlan) {
  const b = bounds(side);
  const removedValue = mulDiv(plan.params.withdrawAssets, b.morphoPrice, 10n ** 36n);
  const allowed = mulDiv(repaidOf(position, plan), BPS, BPS - b.sizeCostBps);
  return removedValue <= allowed && plan.expectedLtvWad > 0n && plan.expectedLtvWad >= position.softLtv - b.floorWad;
}

describe("deleverage sizing (04)", () => {
  it("brings a long to the soft limit minus one point, after impact, fee and slippage", async () => {
    const plan = planOf(await planDeleverage({ market: market("long"), position: long, swap: dex(150n), router, keeperFeeBps: FEE, slippageBps: SLIP, decimals }));
    const target = pct(60n) - TARGET_BELOW_SOFT_WAD;
    expect(plan.expectedLtvWad <= target).toBe(true);
    // Sized from the real cost, so it does not sell much more than needed.
    expect(plan.expectedLtvWad > target - pct(1n)).toBe(true);
    expect(plan.params.withdrawAssets).toBe(plan.params.swapAmountIn);
    expect(plan.params.repayShares < long.borrowShares).toBe(true);
    // The router must be able to repay from the worst-case proceeds less the keeper fee.
    expect(mulDiv(long.debt, plan.params.repayShares, long.borrowShares, "ceil") <= plan.params.swap.minOut - (plan.params.swap.minOut * FEE) / BPS).toBe(true);
  });

  it("skips a long when only a full close reaches the target, since the router refuses that for a keeper", async () => {
    // At 99% the selling cost alone keeps the formula above the whole position.
    const position = { ...long, debt: 594_000_000n, ltv: pct(99n), borrowShares: 594_000_000n * 1_000_000n };
    const r = await planDeleverage({ market: market("long"), position, swap: dex(150n), router, keeperFeeBps: FEE, slippageBps: SLIP, decimals, bounds: bounds("long") });
    expect(r).toEqual({ skip: expect.stringContaining("full close") });
  });

  it("brings a short to the target by spending part of the USDC collateral, with the fee on top", async () => {
    const plan = planOf(await planDeleverage({ market: market("short"), position: short, swap: dex(150n), router, keeperFeeBps: FEE, slippageBps: SLIP, decimals }));
    const target = pct(55n) - TARGET_BELOW_SOFT_WAD;
    expect(plan.expectedLtvWad <= target).toBe(true);
    expect(plan.expectedLtvWad > target - pct(1n)).toBe(true);
    expect(plan.params.withdrawAssets).toBe(plan.params.swapAmountIn + mulDiv(plan.params.swapAmountIn, FEE, BPS, "ceil"));
    expect(mulDiv(short.debt, plan.params.repayShares, short.borrowShares, "ceil") <= plan.params.swap.minOut).toBe(true);
  });

  it.each(["long", "short"] as const)("keeps a %s plan inside the router's floor and size bound (BE-88)", async (side) => {
    const position = side === "long" ? long : short;
    const plan = planOf(await planDeleverage({ market: market(side), position, swap: dex(150n), router, keeperFeeBps: FEE, slippageBps: SLIP, decimals, bounds: bounds(side) }));
    expect(routerAccepts(side, position, plan)).toBe(true);
  });

  it.each(["long", "short"] as const)("keeps a large %s reduction inside the bounds", async (side) => {
    // 20 points above the soft limit: a reduction of about half the position.
    const position = side === "long" ? { ...long, debt: 480_000_000n, ltv: pct(80n), borrowShares: 480_000_000n * 1_000_000n } : { ...short, debt: 125n * 10n ** 16n, ltv: pct(75n), borrowShares: 125n * 10n ** 22n };
    const plan = planOf(await planDeleverage({ market: market(side), position, swap: dex(150n), router, keeperFeeBps: FEE, slippageBps: SLIP, decimals, bounds: bounds(side) }));
    expect(routerAccepts(side, position, plan)).toBe(true);
    expect(plan.expectedLtvWad <= position.softLtv).toBe(true);
  });

  it.each(["long", "short"] as const)("stays inside the bounds when the %s fill is better than the oracle", async (side) => {
    const position = side === "long" ? long : short;
    const plan = planOf(await planDeleverage({ market: market(side), position, swap: dex(-100n), router, keeperFeeBps: FEE, slippageBps: SLIP, decimals, bounds: bounds(side) }));
    expect(routerAccepts(side, position, plan)).toBe(true);
    expect(plan.expectedLtvWad <= position.softLtv - TARGET_BELOW_SOFT_WAD).toBe(true);
  });

  it.each(["long", "short"] as const)("tightens the %s minimum out when the slippage alone would break the size bound", async (side) => {
    // 250 bps impact + 100 bps slippage + the fee loses more than the 330 bps the router allows.
    const position = side === "long" ? long : short;
    const plain = planOf(await planDeleverage({ market: market(side), position, swap: dex(250n), router, keeperFeeBps: FEE, slippageBps: SLIP, decimals }));
    const bounded = planOf(await planDeleverage({ market: market(side), position, swap: dex(250n), router, keeperFeeBps: FEE, slippageBps: SLIP, decimals, bounds: bounds(side) }));
    expect(routerAccepts(side, position, plain)).toBe(false);
    expect(routerAccepts(side, position, bounded)).toBe(true);
    expect(bounded.params.swap.minOut > plain.params.swap.minOut).toBe(true);
  });

  it.each(["long", "short"] as const)("skips a %s plan when even the quoted output breaks the size bound", async (side) => {
    const position = side === "long" ? long : short;
    const r = await planDeleverage({ market: market(side), position, swap: dex(400n), router, keeperFeeBps: FEE, slippageBps: SLIP, decimals, bounds: bounds(side) });
    expect(r).toEqual({ skip: expect.stringContaining("size bound") });
  });

  it("acts only in the 30 minutes before the close", () => {
    const close = 1_800_000_000;
    expect(inPreCloseWindow(close - 1_801, close)).toBe(false);
    expect(inPreCloseWindow(close - 1_800, close)).toBe(true);
    expect(inPreCloseWindow(close - 1, close)).toBe(true);
    expect(inPreCloseWindow(close, close)).toBe(false);
  });
});

describe("simulation before sending", () => {
  const revert = (errorName: "DeleverageTooDeep" | "DeleverageTooLarge" | "PositionHealthy") => {
    const data = encodeErrorResult({ abi: marginRouterAbi, errorName, args: [1n, 2n] });
    const cause = new ContractFunctionRevertedError({ abi: marginRouterAbi, data, functionName: "deleverage" });
    return async () => {
      throw new ContractFunctionExecutionError(cause, { abi: marginRouterAbi, functionName: "deleverage", args: [] });
    };
  };

  it("names the keeper bound the router would refuse on", async () => {
    expect(await refusedByBounds(revert("DeleverageTooDeep"))).toBe("DeleverageTooDeep");
    expect(await refusedByBounds(revert("DeleverageTooLarge"))).toBe("DeleverageTooLarge");
  });

  it("passes a plan that simulates, and rethrows any other revert", async () => {
    expect(await refusedByBounds(async () => ({}))).toBeNull();
    await expect(refusedByBounds(revert("PositionHealthy"))).rejects.toBeInstanceOf(ContractFunctionExecutionError);
  });
});
