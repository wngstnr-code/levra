import { marginRouterAbi } from "@levra/shared/abis";
import type { QuoteOpenRequest, QuoteOpenResponse } from "@levra/shared/api";
import { gapScenarios } from "@levra/shared/gaps";
import {
  BPS,
  ORACLE_PRICE_SCALE,
  WAD,
  borrowApyWad,
  cautiousPriceE8,
  liquidationPriceE8,
  morphoOraclePrice,
  mulDiv,
  positionLtvWad,
  signedDeviationBps,
} from "@levra/shared/math";
import { randomUUID } from "node:crypto";
import { encodeFunctionData, type Hex } from "viem";
import { ApiHttpError, upstream } from "../errors";
import { toApiMarket } from "../routes/markets";
import {
  NEAR_SOFT_LIMIT_BPS,
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
import { shortBorrowAmount, shortOpenCollateral } from "./short-sizing";
import { simulate } from "./simulate";

/** For a short, liquidation is above the price: the distance is how far the price can rise. */
export function shortLiqDistanceBps(oraclePriceE8: bigint, liqPriceE8: bigint): number {
  return liqPriceE8 === 0n ? Number(BPS) : Number(((liqPriceE8 - oraclePriceE8) * BPS) / oraclePriceE8);
}

/**
 * Open (or add to) a short (BE-20): borrow stock worth margin × leverage at the oracle price, sell it for USDC through
 * the aggregator, and keep margin plus proceeds as collateral. Same checks and warnings as a long.
 */
export async function quoteOpenShort({ reader, swap }: QuoteDeps, req: QuoteOpenRequest): Promise<QuoteOpenResponse> {
  const margin = BigInt(req.marginRaw);
  if (margin === 0n) throw new ApiHttpError("BAD_REQUEST", "Margin must be above zero.");

  const [markets, session, fees, block, positions] = await Promise.all([
    upstream(reader.markets),
    upstream(reader.session),
    upstream(reader.routerFees),
    upstream(reader.latestBlock),
    upstream(() => reader.positions(req.user, { fresh: true })),
  ]);
  const m = markets.find((x) => x.info.symbol === req.symbol && x.info.side === "short");
  if (!m) throw new ApiHttpError("NOT_FOUND", `No short market for ${req.symbol}.`);

  const quote = m.info.collateralToken;
  const stock = m.info.loanToken;
  const [quoteDecimals, stockDecimals] = (await upstream(() => tokenDecimals(reader, [quote, stock]))) as [number, number];

  const borrow = shortBorrowAmount(margin, req.leverageE2, m.oraclePriceE8, quoteDecimals, stockDecimals);
  if (borrow === 0n) throw new ApiHttpError("BAD_REQUEST", "This margin and leverage borrow no stock.");

  const [route, midE8] = await Promise.all([
    swap.quote({ tokenIn: stock, tokenOut: quote, amountIn: borrow, sender: reader.deployment.router, slippageBps: req.slippageBps }),
    midPriceE8(swap, quote, stock, quoteDecimals, stockDecimals, m.oraclePriceE8),
  ]);
  const proceeds = route.amountOut;
  const minOut = (proceeds * (BPS - BigInt(req.slippageBps))) / BPS;
  const fee = (proceeds * fees.feeBps) / BPS;
  const execE8 = execPriceE8(proceeds, borrow, quoteDecimals, stockDecimals);

  const existing = positions.find((p) => p.marketId.toLowerCase() === m.info.marketId.toLowerCase());
  const collateralAfter = (existing?.collateralRaw ?? 0n) + shortOpenCollateral(margin, proceeds, fees.feeBps);
  const collateralWorst = (existing?.collateralRaw ?? 0n) + shortOpenCollateral(margin, minOut, fees.feeBps);
  const debtAfter = (existing?.debtRaw ?? 0n) + borrow;
  const price = morphoOraclePrice("short", cautiousPriceE8("short", { priceE8: m.oraclePriceE8, bidE8: m.bidE8, askE8: m.askE8 }), stockDecimals, quoteDecimals);
  const ltvAfter = positionLtvWad(debtAfter, collateralAfter, price);
  const ltvWorst = positionLtvWad(debtAfter, collateralWorst, price);
  const liqE8 = liquidationPriceE8("short", { collateral: collateralAfter, debt: debtAfter, lltvWad: m.lltvWad, stockDecimals, quoteDecimals });
  const deviation = signedDeviationBps(execE8, m.oraclePriceE8);
  // Selling: a price below the mid is worse for the trader.
  const priceImpact = -signedDeviationBps(execE8, midE8);
  const available = m.totalSupplyRaw > m.totalBorrowRaw ? m.totalSupplyRaw - m.totalBorrowRaw : 0n;
  // RiskManager values a short by its debt (stock exposure) in quote units.
  const exposure = mulDiv(debtAfter, ORACLE_PRICE_SCALE, price);

  const { warnings, add, blocked } = warningList();
  if (m.oracleStale) add("ORACLE_STALE", "block", "The oracle price is too old to open a position.");
  if (session.session === "CLOSED") add("SESSION_CLOSED", "warn", "The exchange is closed. The closed-market limit applies and prices can gap at the open.");
  else if (session.closedRegime) add("PRE_CLOSE_WINDOW", "warn", "The exchange closes soon. The closed-market limit already applies.");
  if (Math.abs(deviation) > m.maxDeviationBps) add("HIGH_DEVIATION", "block", "The swap price is too far from the oracle price.");
  else if (Math.abs(deviation) * 2 > m.maxDeviationBps) add("HIGH_DEVIATION", "warn", "The swap price is far from the oracle price.");
  if (priceImpact > PRICE_IMPACT_WARN_BPS) add("HIGH_PRICE_IMPACT", "warn", "This size moves the DEX price noticeably.");
  if (ltvWorst > m.currentSoftLtvWad) add("NEAR_SOFT_LIMIT", "block", "This leverage is above the current limit for this market.");
  else if (ltvWorst + (NEAR_SOFT_LIMIT_BPS * WAD) / BPS > m.currentSoftLtvWad) add("NEAR_SOFT_LIMIT", "warn", "This position starts close to the limit.");
  if (exposure > m.maxPositionUsdRaw) add("POSITION_CAP", "block", "The position would be above the size cap for this market.");
  if (borrow > available) add("LOW_LIQUIDITY", "block", "Not enough stock to borrow in this market right now.");
  if (!m.enabled || session.openingPaused) add("SESSION_CLOSED", "block", "Opening positions is paused for this market.");

  const openData = encodeFunctionData({
    abi: marginRouterAbi,
    functionName: "openShort",
    args: [
      {
        marketId: m.info.marketId,
        margin,
        borrowAssets: borrow,
        swap: { target: route.target, data: route.data, minOut },
        maxLtv: ltvWorst,
        deadline: BigInt(block.time + TX_DEADLINE_SECONDS),
      },
    ],
  });

  const check = await upstream(() =>
    checkRequirements(reader, {
      user: req.user,
      pull: { token: quote, amount: margin, permit: true },
      authorization: true,
      signatures: req.signatures,
      blockTime: block.time,
    }),
  );
  const data: Hex = check.preCalls.length
    ? encodeFunctionData({ abi: marginRouterAbi, functionName: "multicall", args: [[...check.preCalls, openData]] })
    : openData;

  let gasLimit = 0n;
  if (!blocked() && check.ready && check.funded) {
    const sim = await simulate(reader.client, { from: req.user, to: reader.deployment.router, data });
    gasLimit = sim.gasLimit;
    if (sim.warning) warnings.push(sim.warning);
  }

  return {
    quoteId: randomUUID(),
    expiresAt: block.time + QUOTE_TTL_SECONDS,
    market: { ...toApiMarket(m), dexMidPriceE8: midE8.toString(), dexDeviationBps: signedDeviationBps(midE8, m.oraclePriceE8) },
    preview: {
      stockAmountRaw: borrow.toString(),
      collateralRaw: collateralAfter.toString(),
      debtRaw: debtAfter.toString(),
      execPriceE8: execE8.toString(),
      oraclePriceE8: m.oraclePriceE8.toString(),
      deviationBps: deviation,
      priceImpactBps: priceImpact,
      feeRaw: fee.toString(),
      ltvAfterWad: ltvAfter.toString(),
      liqPriceE8: liqE8.toString(),
      liqDistanceBps: shortLiqDistanceBps(m.oraclePriceE8, liqE8),
      borrowApyWad: borrowApyWad(m.borrowRatePerSecondWad).toString(),
      gapScenarios: gapScenarios("short", m.info.symbol, ltvAfter, m.lltvWad),
    },
    requirements: check.requirements,
    tx: { to: reader.deployment.router, data, value: "0", gasLimit: gasLimit.toString() },
    warnings,
  };
}
