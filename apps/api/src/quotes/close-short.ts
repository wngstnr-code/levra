import { SwapError, type SwapQuote } from "@levra/kyber";
import { marginRouterAbi } from "@levra/shared/abis";
import type { QuoteCloseRequest, QuoteCloseResponse } from "@levra/shared/api";
import { BPS, MAX_UINT256, WAD, cautiousPriceE8, morphoOraclePrice, positionLtvWad, signedDeviationBps } from "@levra/shared/math";
import { randomUUID } from "node:crypto";
import { encodeFunctionData, type Address } from "viem";
import { ApiHttpError, upstream } from "../errors";
import { realizedOnReduce, shortCostBasis } from "../positions/cost-basis";
import { toCostEvents } from "../positions/events";
import {
  PRICE_IMPACT_WARN_BPS,
  QUOTE_TTL_SECONDS,
  TX_DEADLINE_SECONDS,
  execPriceE8,
  midPriceE8,
  tokenDecimals,
  warningList,
  type QuoteDeps,
} from "./common";
import { checkRequirements } from "./requirements";
import { closeShortNeed, closeShortReturned, closeShortTarget, firstBuyGuess, rescaleAmountIn } from "./short-sizing";
import { simulate } from "./simulate";

/** Route requests tried to land the stock bought between the need and 3% above the target. */
const MAX_ROUTE_TRIES = 3;
const OVERSHOOT_BPS = 300n;

/**
 * Finds a USDC amount whose route is sure to buy at least `need` stock after slippage. The aggregator only quotes an
 * exact input, so the amount is sized from the oracle price and corrected from the real route.
 */
export async function buyAtLeast(
  swap: QuoteDeps["swap"],
  p: { quote: Address; stock: Address; sender: Address; need: bigint; target: bigint; firstGuess: bigint; slippageBps: number; maxIn: bigint },
): Promise<SwapQuote & { minOut: bigint }> {
  let amountIn = p.firstGuess;
  let best: (SwapQuote & { minOut: bigint }) | null = null;
  for (let i = 0; i < MAX_ROUTE_TRIES; i++) {
    const route = await swap.quote({ tokenIn: p.quote, tokenOut: p.stock, amountIn, sender: p.sender, slippageBps: p.slippageBps });
    const minOut = (route.amountOut * (BPS - BigInt(p.slippageBps))) / BPS;
    if (minOut >= p.need) {
      best = { ...route, minOut };
      if (route.amountOut * BPS <= p.target * (BPS + OVERSHOOT_BPS)) break;
    }
    if (route.amountOut === 0n) break;
    const rescaled = rescaleAmountIn(amountIn, route.amountOut, p.target);
    const next = rescaled > p.maxIn ? p.maxIn : rescaled;
    // Spending all the freed collateral is the most a close can do.
    if (next === amountIn) break;
    amountIn = next;
  }
  if (!best) throw new SwapError("NO_ROUTE", "No route buys back enough stock to repay the debt right now.");
  return best;
}

/**
 * Close or reduce a short (BE-20): buy back the stock owed with part of the USDC collateral, repay, and return the rest.
 * The close buys a little more stock than the debt so the repayment cannot fall short; the leftover stock goes back to
 * the wallet. In the preview it is `stockAmountRaw` (stock bought) minus `debtRepaidRaw`.
 */
export async function quoteCloseShort({ reader, swap, events: store }: QuoteDeps, req: QuoteCloseRequest): Promise<QuoteCloseResponse> {
  const fraction = BigInt(req.fractionWad);
  if (fraction === 0n || fraction > WAD) throw new ApiHttpError("BAD_REQUEST", "fractionWad must be above 0 and at most 1e18.");

  const [markets, fees, block, positions, events] = await Promise.all([
    upstream(reader.markets),
    upstream(reader.routerFees),
    upstream(reader.latestBlock),
    upstream(() => reader.positions(req.user, { fresh: true })),
    upstream(() => store.forUser(req.user)),
  ]);
  const m = markets.find((x) => x.info.marketId.toLowerCase() === req.marketId.toLowerCase());
  if (!m) throw new ApiHttpError("NOT_FOUND", "Unknown market.");
  if (m.info.side !== "short") throw new ApiHttpError("BAD_REQUEST", "This is not a short market.");
  const pos = positions.find((p) => p.marketId.toLowerCase() === req.marketId.toLowerCase());
  if (!pos || pos.collateralRaw === 0n) throw new ApiHttpError("NOT_FOUND", "No position in this market.");

  const quote = m.info.collateralToken;
  const stock = m.info.loanToken;
  const [quoteDecimals, stockDecimals] = (await upstream(() => tokenDecimals(reader, [quote, stock]))) as [number, number];

  const full = fraction === WAD;
  const withdraw = full ? pos.collateralRaw : (pos.collateralRaw * fraction) / WAD;
  const debtRepaid = full ? pos.debtRaw : (pos.debtRaw * fraction) / WAD;
  const repayShares = full ? MAX_UINT256 : ((await upstream(() => reader.borrowShares(m.info.marketId, req.user))) * fraction) / WAD;
  if (withdraw === 0n) throw new ApiHttpError("BAD_REQUEST", "This fraction frees no collateral.");

  const need = debtRepaid === 0n ? 0n : closeShortNeed(debtRepaid);
  const target = closeShortTarget(need, req.slippageBps);
  const guess = firstBuyGuess(target, m.oraclePriceE8, quoteDecimals, stockDecimals);
  const [route, midE8] = await Promise.all([
    need === 0n
      ? Promise.resolve(null)
      : buyAtLeast(swap, {
          quote,
          stock,
          sender: reader.deployment.router,
          need,
          target,
          firstGuess: guess < withdraw ? guess : withdraw,
          slippageBps: req.slippageBps,
          maxIn: withdraw,
        }),
    midPriceE8(swap, quote, stock, quoteDecimals, stockDecimals, m.oraclePriceE8),
  ]);
  const amountIn = route?.amountIn ?? 0n;
  const bought = route?.amountOut ?? 0n;
  const fee = (amountIn * fees.feeBps) / BPS;
  const returned = closeShortReturned(withdraw, amountIn, fees.feeBps);
  // The amounts are fixed by the parameters, so the return only needs a hair of room.
  const minReturnRaw = returned - returned / 10_000n - 1n;
  const minReturn = minReturnRaw > 0n ? minReturnRaw : 0n;

  const execE8 = bought > 0n ? execPriceE8(amountIn, bought, quoteDecimals, stockDecimals) : 0n;
  const price = morphoOraclePrice("short", cautiousPriceE8("short", { priceE8: m.oraclePriceE8, bidE8: m.bidE8, askE8: m.askE8 }), stockDecimals, quoteDecimals);
  const ltvAfter = full ? 0n : positionLtvWad(pos.debtRaw - debtRepaid, pos.collateralRaw - withdraw, price);
  const deviation = execE8 > 0n ? signedDeviationBps(execE8, m.oraclePriceE8) : 0;
  // Buying: a price above the mid is worse for the trader.
  const priceImpact = execE8 > 0n ? signedDeviationBps(execE8, midE8) : 0;

  const { warnings, add, blocked } = warningList();
  if (!full && m.oracleHardStale) add("ORACLE_STALE", "block", "Morpho cannot price this market right now, so a partial close would fail. A full close still works.");
  if (returned < 0n) add("HIGH_PRICE_IMPACT", "block", "Buying back this share of the stock costs more than the collateral it frees.");
  if (Math.abs(deviation) * 2 > m.maxDeviationBps) add("HIGH_DEVIATION", "warn", "The swap price is far from the oracle price.");
  if (priceImpact > PRICE_IMPACT_WARN_BPS) add("HIGH_PRICE_IMPACT", "warn", "This size moves the DEX price noticeably.");
  if (!full && ltvAfter > pos.ltvWad && ltvAfter > m.currentSoftLtvWad) add("NEAR_SOFT_LIMIT", "block", "This reduction would leave the position above the limit.");

  const data = encodeFunctionData({
    abi: marginRouterAbi,
    functionName: "closeShort",
    args: [
      {
        marketId: m.info.marketId,
        repayShares,
        withdrawAssets: full ? MAX_UINT256 : withdraw,
        // closeShort takes an exact USDC amount; MAX_UINT256 is not allowed for a short.
        swapAmountIn: amountIn,
        swap: route ? { target: route.target, data: route.data, minOut: route.minOut } : { target: reader.deployment.router, data: "0x", minOut: 0n },
        minReturn,
        deadline: BigInt(block.time + TX_DEADLINE_SECONDS),
      },
    ],
  });

  const check = await upstream(() => checkRequirements(reader, { user: req.user, authorization: true, blockTime: block.time }));

  let gasLimit = 0n;
  if (!blocked() && check.ready) {
    const sim = await simulate(reader.client, { from: req.user, to: reader.deployment.router, data });
    gasLimit = sim.gasLimit;
    if (sim.warning) warnings.push(sim.warning);
  }

  const settled = returned > 0n ? returned : 0n;
  return {
    quoteId: randomUUID(),
    expiresAt: block.time + QUOTE_TTL_SECONDS,
    preview: {
      stockAmountRaw: bought.toString(),
      debtRepaidRaw: debtRepaid.toString(),
      collateralWithdrawnRaw: withdraw.toString(),
      returnedRaw: settled.toString(),
      execPriceE8: execE8.toString(),
      oraclePriceE8: m.oraclePriceE8.toString(),
      deviationBps: deviation,
      priceImpactBps: priceImpact,
      feeRaw: fee.toString(),
      ltvAfterWad: ltvAfter.toString(),
      realizedPnlUsdRaw: realizedOnReduce(shortCostBasis(toCostEvents(events), m.info.marketId), debtRepaid, settled).toString(),
    },
    requirements: check.requirements,
    tx: { to: reader.deployment.router, data, value: "0", gasLimit: gasLimit.toString() },
    warnings,
  };
}
