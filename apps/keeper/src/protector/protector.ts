import { protectedPositions, type Db } from "@levra/db";
import type { SwapSource } from "@levra/kyber";
import { tokensByChain } from "@levra/shared/addresses";
import { isChainId, type ChainId } from "@levra/shared/chains";
import { findStock } from "@levra/shared/markets";
import { lensAbi, marginRouterAbi, morphoAbi, riskManagerAbi } from "@levra/shared/abis";
import { nextCloseAfter } from "@levra/shared/calendar";
import type { Deployment } from "@levra/shared/deployments";
import { BPS, WAD, deleverageSellValue, deviationBps, mulDiv, swapPriceE8 } from "@levra/shared/math";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  getAddress,
  parseAbi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { scheduleForChain } from "../calendar/poster";
import { morphoOn } from "../chain";
import type { Job } from "../runner";

/** `MarginRouter.isKeeper()`. Temporary until the ABI export has it (requested from Wangsit). */
const isKeeperAbi = parseAbi(["function isKeeper(address) view returns (bool)"]);

/** The protector acts in the last 30 minutes before a close (04, pre-close timeline). */
export const PRE_CLOSE_SECONDS = 30 * 60;
/** Target: the current soft limit minus 1 percentage point (04, initial proposal). */
export const TARGET_BELOW_SOFT_WAD = WAD / 100n;
/** First guess of the price impact, corrected from the real route. */
const FIRST_IMPACT_GUESS_BPS = 100n;
/** Added to the measured cost so rounding and the repay buffer cannot leave the position just above the target. */
const SIZE_MARGIN_WAD = (10n * WAD) / BPS;
/** Debt accrues between the plan and the block; 1 bps covers far more than a minute. */
const REPAY_BUFFER_BPS = 1n;
const TX_DEADLINE_SECONDS = 120;
/** Monad charges the gas limit (02), so the margin over the estimate stays small. */
const GAS_MARGIN_PCT = 15n;
/** `CLOSED` in the oracle's `Session` enum (03). */
const SESSION_CLOSED = 5;

export const inPreCloseWindow = (now: number, closeAt: number) => now >= closeAt - PRE_CLOSE_SECONDS && now < closeAt;

/** Share of `valueIn` lost on the way to `valueOut`, as WAD. Zero when nothing is lost. */
const costWad = (valueIn: bigint, valueOut: bigint) => (valueOut >= valueIn ? 0n : mulDiv(valueIn - valueOut, WAD, valueIn, "ceil"));

/** One position as `Lens` reports it. Amounts in base units, ratios WAD. */
export type ProtectedPosition = { collateral: bigint; debt: bigint; ltv: bigint; softLtv: bigint; borrowShares: bigint };

export type CloseParams = {
  marketId: Hex;
  repayShares: bigint;
  withdrawAssets: bigint;
  swapAmountIn: bigint;
  swap: { target: Address; data: Hex; minOut: bigint };
  minReturn: bigint;
  deadline: bigint;
};

export type DeleveragePlan = { params: Omit<CloseParams, "deadline">; execPriceE8: bigint; expectedLtvWad: bigint };
/** A plan, or why no reduction the router accepts exists right now. */
export type PlanResult = { plan: DeleveragePlan } | { skip: string };

/**
 * What the router checks on a keeper reduction (D-91, D-92), so a plan never fails on them:
 * the LTV after must stay at or above `softLtv - floorWad` with debt left, and the collateral taken out, valued at the
 * Morpho oracle price, may be at most the debt repaid / (1 - sizeCostBps).
 */
export type KeeperBounds = {
  /** `DELEVERAGE_FLOOR`, WAD. */
  floorWad: bigint;
  /** `maxDeviationBps + keeperFeeBps + DELEVERAGE_SLACK_BPS`, as in `_checkKeeperSize`. */
  sizeCostBps: bigint;
  /** The market's Morpho oracle `price()`: collateral to loan token units, scaled by 1e36. */
  morphoPrice: bigint;
};

type PlanInput = {
  market: Deployment["markets"][number];
  position: ProtectedPosition;
  swap: SwapSource;
  router: Address;
  keeperFeeBps: bigint;
  slippageBps: bigint;
  /** USDC and the stock on the market's chain: Base stocks have 8 decimals, the others 18. */
  decimals: { quote: number; stock: number };
  /** Absent for a router without the keeper floor (the live Monad router before SC-87). */
  bounds?: KeeperBounds;
};

const ORACLE_PRICE_SCALE = 10n ** 36n;
/** The plan aims this far above the router's floor at least, against a fill better than quoted. */
const FLOOR_MARGIN_WAD = WAD / 200n;
/** A tighter minimum out keeps this much room under the quoted output, so a quote that moves a little still fills. */
const MIN_SLIPPAGE_BPS = 10n;

/** Debt repaid from `minOut` of loan token, after the keeper fee (long only) and the accrual buffer. */
const repayFrom = (minOut: bigint, feeBps: bigint) => {
  const net = minOut - (minOut * feeBps) / BPS;
  return net - (net * REPAY_BUFFER_BPS) / BPS - 1n;
};

/**
 * The size bound (D-92): if the repay from `minOut` is too small for the collateral taken out, raise `minOut` (a
 * tighter slippage) as far as the quote allows. Null when even the quoted output is not enough.
 */
function fitMinOut(minOut: bigint, quotedOut: bigint, removed: bigint, feeBps: bigint, b: KeeperBounds, debt: bigint, borrowShares: bigint) {
  const need = mulDiv(mulDiv(removed, b.morphoPrice, ORACLE_PRICE_SCALE, "ceil"), BPS - b.sizeCostBps, BPS, "ceil");
  const repaid = (m: bigint) => mulDiv(debt, mulDiv(borrowShares, repayFrom(m, feeBps), debt), borrowShares);
  if (repaid(minOut) >= need) return minOut;
  const ceiling = (quotedOut * (BPS - MIN_SLIPPAGE_BPS)) / BPS;
  let m = mulDiv((need + 2n) * BPS, BPS, (BPS - feeBps) * (BPS - REPAY_BUFFER_BPS), "ceil") + 1n;
  for (let i = 0; i < 8 && repaid(m) < need; i++) m += 1n + m / 1_000_000n;
  return repaid(m) >= need && m <= ceiling ? m : null;
}

function checkFloor(expectedLtvWad: bigint, softLtv: bigint, b: KeeperBounds | undefined): string | null {
  if (expectedLtvWad === 0n) return "the target needs a full close, which the router refuses for a keeper";
  if (!b) return null;
  const floor = softLtv > b.floorWad ? softLtv - b.floorWad : 0n;
  return expectedLtvWad < floor + FLOOR_MARGIN_WAD ? "the plan would end too far below the soft limit" : null;
}

/**
 * Sizes a long reduction with the 04 formula: sell stock worth (D - t·V) / ((1 - c) - t), where c is the keeper fee plus
 * slippage plus price impact. The impact is guessed first and taken from the real route on the second pass. V comes from
 * the LTV `Lens` reports, so it uses the same cautious price as the contract.
 */
async function planLong({ market, position: p, swap, router, keeperFeeBps, slippageBps, decimals, bounds }: PlanInput, targetLtv: bigint): Promise<PlanResult> {
  const value = mulDiv(p.debt, WAD, p.ltv);
  let cost = ((keeperFeeBps + slippageBps + FIRST_IMPACT_GUESS_BPS) * WAD) / BPS;
  for (let pass = 0; ; pass++) {
    const sellValue = deleverageSellValue({ debt: p.debt, value, targetLtvWad: targetLtv, costWad: cost });
    const sell = mulDiv(p.collateral, sellValue, value, "ceil");
    if (sell >= p.collateral) return { skip: "the target needs a full close, which the router refuses for a keeper" };
    const q = await swap.quote({ tokenIn: market.collateralToken, tokenOut: market.loanToken, amountIn: sell, sender: router, slippageBps: Number(slippageBps) });
    let minOut = (q.amountOut * (BPS - slippageBps)) / BPS;
    const soldValue = mulDiv(value, sell, p.collateral);
    const realCost = costWad(soldValue, repayFrom(minOut, keeperFeeBps));
    if (pass === 0 && realCost + SIZE_MARGIN_WAD > cost) {
      cost = realCost + SIZE_MARGIN_WAD;
      continue;
    }
    if (bounds) {
      const fitted = fitMinOut(minOut, q.amountOut, sell, keeperFeeBps, bounds, p.debt, p.borrowShares);
      if (fitted === null) return { skip: "the route loses too much for the router's size bound" };
      minOut = fitted;
    }
    const repay = repayFrom(minOut, keeperFeeBps);
    if (repay >= p.debt) return { skip: "the target needs a full close, which the router refuses for a keeper" };
    const repayShares = mulDiv(p.borrowShares, repay > 0n ? repay : 0n, p.debt);
    const debtAfter = p.debt - mulDiv(p.debt, repayShares, p.borrowShares);
    const expectedLtvWad = mulDiv(debtAfter, WAD, value - soldValue);
    const tooDeep = checkFloor(expectedLtvWad, p.softLtv, bounds);
    if (tooDeep) return { skip: tooDeep };
    return {
      plan: {
        params: { marketId: market.marketId, repayShares, withdrawAssets: sell, swapAmountIn: sell, swap: { target: q.target, data: q.data, minOut }, minReturn: 0n },
        execPriceE8: swapPriceE8(q.amountOut, sell, decimals.quote, decimals.stock),
        expectedLtvWad,
      },
    };
  }
}

/**
 * Sizes a short reduction with the same formula in dollars: spend X of the USDC collateral to buy back stock, with
 * X = (D·p - t·V) / ((1 - c) - t). The keeper fee is taken from the collateral on top of X.
 */
async function planShort({ market, position: p, swap, router, keeperFeeBps, slippageBps, decimals, bounds }: PlanInput, targetLtv: bigint): Promise<PlanResult> {
  const debtValue = mulDiv(p.ltv, p.collateral, WAD);
  const maxSpend = mulDiv(p.collateral, BPS, BPS + keeperFeeBps);
  let cost = ((keeperFeeBps + slippageBps + FIRST_IMPACT_GUESS_BPS) * WAD) / BPS;
  for (let pass = 0; ; pass++) {
    const wanted = deleverageSellValue({ debt: debtValue, value: p.collateral, targetLtvWad: targetLtv, costWad: cost });
    if (wanted >= maxSpend) return { skip: "the target needs a full close, which the router refuses for a keeper" };
    const spend = wanted;
    const q = await swap.quote({ tokenIn: market.collateralToken, tokenOut: market.loanToken, amountIn: spend, sender: router, slippageBps: Number(slippageBps) });
    let minOut = (q.amountOut * (BPS - slippageBps)) / BPS;
    const fee = mulDiv(spend, keeperFeeBps, BPS, "ceil");
    const boughtValue = mulDiv(minOut, debtValue, p.debt);
    const realCost = costWad(spend + fee, boughtValue);
    if (pass === 0 && realCost + SIZE_MARGIN_WAD > cost) {
      cost = realCost + SIZE_MARGIN_WAD;
      continue;
    }
    if (bounds) {
      // The short's keeper fee comes out of the collateral, not the bought stock, so the repay has no fee cut.
      const fitted = fitMinOut(minOut, q.amountOut, spend + fee, 0n, bounds, p.debt, p.borrowShares);
      if (fitted === null) return { skip: "the route loses too much for the router's size bound" };
      minOut = fitted;
    }
    const repay = repayFrom(minOut, 0n);
    if (repay >= p.debt) return { skip: "the target needs a full close, which the router refuses for a keeper" };
    const repayShares = mulDiv(p.borrowShares, repay > 0n ? repay : 0n, p.debt);
    const debtValueAfter = debtValue - mulDiv(debtValue, repayShares, p.borrowShares);
    const collateralAfter = p.collateral - spend - fee;
    const expectedLtvWad = collateralAfter <= 0n ? 0n : mulDiv(debtValueAfter, WAD, collateralAfter);
    const tooDeep = checkFloor(expectedLtvWad, p.softLtv, bounds);
    if (tooDeep) return { skip: tooDeep };
    return {
      plan: {
        params: { marketId: market.marketId, repayShares, withdrawAssets: spend + fee, swapAmountIn: spend, swap: { target: q.target, data: q.data, minOut }, minReturn: 0n },
        execPriceE8: swapPriceE8(spend, q.amountOut, decimals.quote, decimals.stock),
        expectedLtvWad,
      },
    };
  }
}

export function planDeleverage(input: PlanInput): Promise<PlanResult> {
  const target = input.position.softLtv > TARGET_BELOW_SOFT_WAD ? input.position.softLtv - TARGET_BELOW_SOFT_WAD : 0n;
  return input.market.side === "long" ? planLong(input, target) : planShort(input, target);
}

const morphoOracleAbi = parseAbi(["function price() view returns (uint256)"]);
const BOUND_ERRORS = new Set(["DeleverageTooDeep", "DeleverageTooLarge"]);

/** `DELEVERAGE_FLOOR` and `DELEVERAGE_SLACK_BPS`, or null for a router built before them (the live Monad router). */
export async function keeperLimits(client: PublicClient, router: Address): Promise<{ floorWad: bigint; slackBps: bigint } | null> {
  try {
    const [floorWad, slackBps] = await Promise.all([
      client.readContract({ address: router, abi: marginRouterAbi, functionName: "DELEVERAGE_FLOOR" }),
      client.readContract({ address: router, abi: marginRouterAbi, functionName: "DELEVERAGE_SLACK_BPS" }),
    ]);
    return { floorWad, slackBps };
  } catch (err) {
    // No such function answers with empty data or a bare revert; an RPC failure is rethrown.
    const missing = err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionZeroDataError || e instanceof ContractFunctionRevertedError);
    if (missing) return null;
    throw err;
  }
}

/** Runs the simulation; returns the error name when the router refuses on a keeper bound, null when it passes. */
export async function refusedByBounds(simulate: () => Promise<unknown>): Promise<string | null> {
  try {
    await simulate();
    return null;
  } catch (err) {
    const reverted = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    const name = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
    if (name && BOUND_ERRORS.has(name)) return name;
    throw err;
  }
}

/** The next close by the calendar (BE-30), unix seconds. */
export type CloseSource = (db: Db, now: number, chainId: number) => Promise<number>;
export const closeFromCalendar: CloseSource = async (db, now, chainId) => nextCloseAfter(now, await scheduleForChain(db, chainId));

export type ProtectorOptions = {
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
  deployment: Deployment;
  swap: SwapSource;
  nextClose?: CloseSource;
  slippageBps?: number;
  intervalMs?: number;
};

/**
 * Auto-deleverage (BE-31). In the last 30 minutes before a close, every position with protection on that is above the
 * current soft limit is reduced to the soft limit minus 1 point through `MarginRouter.deleverage`. Outside that window,
 * and after the close, it does nothing. A failure is retried on the next run, which comes every minute.
 */
export function createProtector({ client, wallet, deployment, swap, nextClose = closeFromCalendar, slippageBps = 100, intervalMs = 60_000 }: ProtectorOptions): Job {
  const router = deployment.router;
  const slip = BigInt(slippageBps);
  if (!isChainId(deployment.chainId)) throw new Error(`Deployment is for chain ${deployment.chainId}, which has no addresses in packages/shared`);
  const chain: ChainId = deployment.chainId;
  const decimalsOf = (market: Deployment["markets"][number]) => {
    const stock = findStock(chain, market.symbol);
    if (!stock) throw new Error(`${market.symbol} is not a stock on chain ${chain}`);
    return { quote: tokensByChain[chain].USDC.decimals, stock: stock.decimals };
  };

  return {
    name: "protector",
    intervalMs,
    async run({ db, chainId, logger }) {
      const keeper = await client.readContract({ address: router, abi: isKeeperAbi, functionName: "isKeeper", args: [wallet.account.address] });
      if (!keeper) throw new Error(`Key ${wallet.account.address} is not a router keeper`);
      const block = await client.getBlock({ blockTag: "latest" });
      const now = Number(block.timestamp);
      const closeAt = await nextClose(db, now, chainId);
      if (!inPreCloseWindow(now, closeAt)) return { active: false, now, closeAt };

      const ours = new Map(deployment.markets.map((m) => [m.marketId.toLowerCase(), m]));
      // Opt-in made on a previous router does not carry over (03 section 6, BE-100).
      const current = { address: router, hasPrevious: (deployment.previousRouters?.length ?? 0) > 0 };
      const candidates = (await protectedPositions(db, chainId, current)).filter((c) => ours.has(c.marketId));
      const keeperFeeBps = await client.readContract({ address: router, abi: marginRouterAbi, functionName: "keeperFeeBps" });
      const limits = await keeperLimits(client, router);
      const actions: Record<string, unknown>[] = [];
      const failures: string[] = [];

      for (const c of candidates) {
        const market = ours.get(c.marketId)!;
        const user = getAddress(c.user);
        const entry = { symbol: market.symbol, side: market.side, user };
        try {
          // The indexed event says whom to look at; the chain decides.
          const [enabled, views, morphoPosition, config, markets] = await Promise.all([
            client.readContract({ address: router, abi: marginRouterAbi, functionName: "protectionEnabled", args: [user, market.marketId] }),
            client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getPositions", args: [user] }),
            client.readContract({ address: morphoOn(deployment.chainId), abi: morphoAbi, functionName: "position", args: [market.marketId, user] }),
            client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [market.marketId] }),
            client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getMarkets" }),
          ]);
          const view = views.find((v) => v.marketId.toLowerCase() === c.marketId);
          if (!enabled || !view || view.debt === 0n || view.ltv <= view.softLtv) continue;
          // The router refuses a keeper reduction once the oracle says CLOSED (MarketClosed), which can come before the
          // calendar's close: an early close, or a Chainlink feed that stops first (BE-89).
          if (markets.find((m) => m.marketId.toLowerCase() === c.marketId)?.session === SESSION_CLOSED) {
            actions.push({ ...entry, skipped: "market closed" });
            continue;
          }

          const position = { collateral: view.collateral, debt: view.debt, ltv: view.ltv, softLtv: view.softLtv, borrowShares: morphoPosition.borrowShares };
          const bounds = limits
            ? {
                floorWad: limits.floorWad,
                sizeCostBps: BigInt(config.maxDeviationBps) + keeperFeeBps + limits.slackBps,
                morphoPrice: await client.readContract({ address: market.oracle, abi: morphoOracleAbi, functionName: "price" }),
              }
            : undefined;
          const result = await planDeleverage({ market, position, swap, router, keeperFeeBps, slippageBps: slip, decimals: decimalsOf(market), bounds });
          if ("skip" in result) {
            logger.warn({ ...entry, reason: result.skip }, "deleverage skipped");
            actions.push({ ...entry, skipped: result.skip });
            continue;
          }
          const { plan } = result;
          const oracleE8 = markets.find((m) => m.marketId.toLowerCase() === c.marketId)?.priceE8 ?? 0n;
          // The router rejects a keeper reduction that trades too far from the oracle; checked here to save the gas.
          const deviation = oracleE8 === 0n ? null : deviationBps(plan.execPriceE8, oracleE8);
          if (deviation === null || deviation > BigInt(config.maxDeviationBps)) {
            logger.warn({ ...entry, deviation: deviation?.toString(), max: config.maxDeviationBps }, "deleverage skipped: the DEX price is too far from the oracle");
            actions.push({ ...entry, skipped: "price deviation", deviation: deviation?.toString() });
            continue;
          }

          const params = { ...plan.params, deadline: BigInt(now + TX_DEADLINE_SECONDS) };
          const request = { address: router, abi: marginRouterAbi, functionName: "deleverage", args: [user, params] } as const;
          // A plan the router refuses on its keeper bounds is not sent: the next run sizes it again from fresh numbers.
          const refused = await refusedByBounds(() => client.simulateContract({ ...request, account: wallet.account }));
          if (refused) {
            logger.warn({ ...entry, error: refused }, "deleverage skipped: the router would refuse the plan");
            actions.push({ ...entry, skipped: refused });
            continue;
          }
          const gas = await client.estimateContractGas({ ...request, account: wallet.account });
          const hash = await wallet.writeContract({ ...request, gas: gas + (gas * GAS_MARGIN_PCT) / 100n });
          const receipt = await client.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error(`deleverage reverted: ${hash}`);
          const summary = { ...entry, ltvBefore: view.ltv.toString(), expectedLtv: plan.expectedLtvWad.toString(), tx: hash };
          logger.warn(summary, "position deleveraged");
          actions.push(summary);
        } catch (err) {
          logger.error({ ...entry, err }, "deleverage failed, retrying next run");
          failures.push(`${market.symbol} ${market.side} ${user}: ${(err as Error).message.split("\n")[0]}`);
        }
      }
      // Throwing marks the heartbeat with the error, so the team sees it (BE-50); the next run retries.
      if (failures.length > 0) throw new Error(`${failures.length} deleverage(s) failed: ${failures.join("; ")}`);
      return { active: true, now, closeAt, candidates: candidates.length, actions };
    },
  };
}
