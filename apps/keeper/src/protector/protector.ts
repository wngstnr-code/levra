import { protectedPositions, type Db } from "@levra/db";
import type { SwapSource } from "@levra/kyber";
import { external, tokens } from "@levra/shared/addresses";
import { lensAbi, marginRouterAbi, morphoAbi, riskManagerAbi } from "@levra/shared/abis";
import { nextCloseAfter } from "@levra/shared/calendar";
import type { Deployment } from "@levra/shared/deployments";
import { BPS, MAX_UINT256, WAD, deleverageSellValue, deviationBps, mulDiv, swapPriceE8 } from "@levra/shared/math";
import { getAddress, parseAbi, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { scheduleFromLogger } from "../calendar/poster";
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
const QUOTE_DECIMALS = tokens.USDC.decimals;
const STOCK_DECIMALS = 18;

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

type PlanInput = {
  market: Deployment["markets"][number];
  position: ProtectedPosition;
  swap: SwapSource;
  router: Address;
  keeperFeeBps: bigint;
  slippageBps: bigint;
};

/**
 * Sizes a long reduction with the 04 formula: sell stock worth (D - t·V) / ((1 - c) - t), where c is the keeper fee plus
 * slippage plus price impact. The impact is guessed first and taken from the real route on the second pass. V comes from
 * the LTV `Lens` reports, so it uses the same cautious price as the contract.
 */
async function planLong({ market, position: p, swap, router, keeperFeeBps, slippageBps }: PlanInput, targetLtv: bigint): Promise<DeleveragePlan> {
  const value = mulDiv(p.debt, WAD, p.ltv);
  let cost = ((keeperFeeBps + slippageBps + FIRST_IMPACT_GUESS_BPS) * WAD) / BPS;
  for (let pass = 0; ; pass++) {
    const sellValue = deleverageSellValue({ debt: p.debt, value, targetLtvWad: targetLtv, costWad: cost });
    const sell = (() => {
      const s = mulDiv(p.collateral, sellValue, value, "ceil");
      return s > p.collateral ? p.collateral : s;
    })();
    const q = await swap.quote({ tokenIn: market.collateralToken, tokenOut: market.loanToken, amountIn: sell, sender: router, slippageBps: Number(slippageBps) });
    const minOut = (q.amountOut * (BPS - slippageBps)) / BPS;
    const net = minOut - (minOut * keeperFeeBps) / BPS;
    const soldValue = mulDiv(value, sell, p.collateral);
    const realCost = costWad(soldValue, net);
    if (pass === 0 && realCost + SIZE_MARGIN_WAD > cost) {
      cost = realCost + SIZE_MARGIN_WAD;
      continue;
    }
    const full = sell === p.collateral || net >= p.debt;
    const repay = net - (net * REPAY_BUFFER_BPS) / BPS - 1n;
    const repayShares = full ? MAX_UINT256 : mulDiv(p.borrowShares, repay > 0n ? repay : 0n, p.debt);
    const debtAfter = full ? 0n : p.debt - mulDiv(p.debt, repayShares, p.borrowShares);
    const valueAfter = value - soldValue;
    return {
      params: {
        marketId: market.marketId,
        repayShares,
        withdrawAssets: full ? MAX_UINT256 : sell,
        swapAmountIn: full ? MAX_UINT256 : sell,
        swap: { target: q.target, data: q.data, minOut },
        minReturn: 0n,
      },
      execPriceE8: swapPriceE8(q.amountOut, sell, QUOTE_DECIMALS, STOCK_DECIMALS),
      expectedLtvWad: full || valueAfter === 0n ? 0n : mulDiv(debtAfter, WAD, valueAfter),
    };
  }
}

/**
 * Sizes a short reduction with the same formula in dollars: spend X of the USDC collateral to buy back stock, with
 * X = (D·p - t·V) / ((1 - c) - t). The keeper fee is taken from the collateral on top of X.
 */
async function planShort({ market, position: p, swap, router, keeperFeeBps, slippageBps }: PlanInput, targetLtv: bigint): Promise<DeleveragePlan> {
  const debtValue = mulDiv(p.ltv, p.collateral, WAD);
  const maxSpend = mulDiv(p.collateral, BPS, BPS + keeperFeeBps);
  let cost = ((keeperFeeBps + slippageBps + FIRST_IMPACT_GUESS_BPS) * WAD) / BPS;
  for (let pass = 0; ; pass++) {
    const wanted = deleverageSellValue({ debt: debtValue, value: p.collateral, targetLtvWad: targetLtv, costWad: cost });
    const spend = wanted > maxSpend ? maxSpend : wanted;
    const q = await swap.quote({ tokenIn: market.collateralToken, tokenOut: market.loanToken, amountIn: spend, sender: router, slippageBps: Number(slippageBps) });
    const minOut = (q.amountOut * (BPS - slippageBps)) / BPS;
    const fee = mulDiv(spend, keeperFeeBps, BPS, "ceil");
    const boughtValue = mulDiv(minOut, debtValue, p.debt);
    const realCost = costWad(spend + fee, boughtValue);
    if (pass === 0 && realCost + SIZE_MARGIN_WAD > cost) {
      cost = realCost + SIZE_MARGIN_WAD;
      continue;
    }
    const repay = minOut - (minOut * REPAY_BUFFER_BPS) / BPS - 1n;
    const full = repay >= p.debt;
    const repayShares = full ? MAX_UINT256 : mulDiv(p.borrowShares, repay > 0n ? repay : 0n, p.debt);
    const debtValueAfter = full ? 0n : debtValue - mulDiv(debtValue, repayShares, p.borrowShares);
    const collateralAfter = p.collateral - spend - fee;
    return {
      params: {
        marketId: market.marketId,
        repayShares,
        withdrawAssets: spend + fee,
        swapAmountIn: spend,
        swap: { target: q.target, data: q.data, minOut },
        minReturn: 0n,
      },
      execPriceE8: swapPriceE8(spend, q.amountOut, QUOTE_DECIMALS, STOCK_DECIMALS),
      expectedLtvWad: collateralAfter <= 0n ? 0n : mulDiv(debtValueAfter, WAD, collateralAfter),
    };
  }
}

export function planDeleverage(input: PlanInput): Promise<DeleveragePlan> {
  const target = input.position.softLtv > TARGET_BELOW_SOFT_WAD ? input.position.softLtv - TARGET_BELOW_SOFT_WAD : 0n;
  return input.market.side === "long" ? planLong(input, target) : planShort(input, target);
}

/** The next close by the calendar (BE-30), unix seconds. */
export type CloseSource = (db: Db, now: number) => Promise<number>;
export const closeFromCalendar: CloseSource = async (db, now) => nextCloseAfter(now, await scheduleFromLogger(db));

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

  return {
    name: "protector",
    intervalMs,
    async run({ db, logger }) {
      const keeper = await client.readContract({ address: router, abi: isKeeperAbi, functionName: "isKeeper", args: [wallet.account.address] });
      if (!keeper) throw new Error(`Key ${wallet.account.address} is not a router keeper`);
      const block = await client.getBlock({ blockTag: "latest" });
      const now = Number(block.timestamp);
      const closeAt = await nextClose(db, now);
      if (!inPreCloseWindow(now, closeAt)) return { active: false, now, closeAt };

      const ours = new Map(deployment.markets.map((m) => [m.marketId.toLowerCase(), m]));
      const candidates = (await protectedPositions(db)).filter((c) => ours.has(c.marketId));
      const keeperFeeBps = await client.readContract({ address: router, abi: marginRouterAbi, functionName: "keeperFeeBps" });
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
            client.readContract({ address: external.morpho, abi: morphoAbi, functionName: "position", args: [market.marketId, user] }),
            client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [market.marketId] }),
            client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getMarkets" }),
          ]);
          const view = views.find((v) => v.marketId.toLowerCase() === c.marketId);
          if (!enabled || !view || view.debt === 0n || view.ltv <= view.softLtv) continue;

          const position = { collateral: view.collateral, debt: view.debt, ltv: view.ltv, softLtv: view.softLtv, borrowShares: morphoPosition.borrowShares };
          const plan = await planDeleverage({ market, position, swap, router, keeperFeeBps, slippageBps: slip });
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
