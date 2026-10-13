import { marginRouterAbi } from "@levra/shared/abis";
import type { QuoteOpenRequest, QuoteOpenResponse } from "@levra/shared/api";
import { gapScenarios } from "@levra/shared/gaps";
import {
  BPS,
  WAD,
  borrowApyWad,
  cautiousPriceE8,
  collateralValue,
  liquidationPriceE8,
  morphoOraclePrice,
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
  liqDistanceBps,
  midPriceE8,
  tokenDecimals,
  warningList,
  type QuoteDeps,
} from "./common";
import { checkRequirements } from "./requirements";
import { simulate } from "./simulate";

export async function quoteOpenLong({ reader, swap }: QuoteDeps, req: QuoteOpenRequest): Promise<QuoteOpenResponse> {
  const margin = BigInt(req.marginRaw);
  if (margin === 0n) throw new ApiHttpError("BAD_REQUEST", "Margin must be above zero.");
  if (req.leverageE2 < 100) throw new ApiHttpError("BAD_REQUEST", "Leverage must be at least 1x (100).");

  const [markets, session, fees, block, positions] = await Promise.all([
    upstream(reader.markets),
    upstream(reader.session),
    upstream(reader.routerFees),
    upstream(reader.latestBlock),
    upstream(() => reader.positions(req.user, { fresh: true })),
  ]);
  const m = markets.find((x) => x.info.symbol === req.symbol && x.info.side === "long");
  if (!m) throw new ApiHttpError("NOT_FOUND", `No long market for ${req.symbol}.`);

  const quote = m.info.loanToken;
  const stock = m.info.collateralToken;
  const [quoteDecimals, stockDecimals] = (await upstream(() => tokenDecimals(reader, [quote, stock]))) as [number, number];

  const gross = (margin * BigInt(req.leverageE2)) / 100n;
  const borrow = gross - margin;
  const fee = (gross * fees.feeBps) / BPS;
  const swapIn = gross - fee;

  const [route, midE8] = await Promise.all([
    swap.quote({ tokenIn: quote, tokenOut: stock, amountIn: swapIn, sender: reader.deployment.router, slippageBps: req.slippageBps }),
    midPriceE8(swap, quote, stock, quoteDecimals, stockDecimals, m.oraclePriceE8),
  ]);
  const expectedOut = route.amountOut;
  const minOut = (expectedOut * (BPS - BigInt(req.slippageBps))) / BPS;
  const execE8 = execPriceE8(swapIn, expectedOut, quoteDecimals, stockDecimals);

  const existing = positions.find((p) => p.marketId.toLowerCase() === m.info.marketId.toLowerCase());
  const collateralAfter = (existing?.collateralRaw ?? 0n) + expectedOut;
  const debtAfter = (existing?.debtRaw ?? 0n) + borrow;
  const price = morphoOraclePrice("long", cautiousPriceE8("long", { priceE8: m.oraclePriceE8, bidE8: m.bidE8, askE8: m.askE8 }), stockDecimals, quoteDecimals);
  const ltvAfter = positionLtvWad(debtAfter, collateralAfter, price);
  const ltvWorst = positionLtvWad(debtAfter, (existing?.collateralRaw ?? 0n) + minOut, price);
  const liqE8 = liquidationPriceE8("long", { collateral: collateralAfter, debt: debtAfter, lltvWad: m.lltvWad, stockDecimals, quoteDecimals });
  const deviation = signedDeviationBps(execE8, m.oraclePriceE8);
  const priceImpact = signedDeviationBps(execE8, midE8);
  const available = m.totalSupplyRaw > m.totalBorrowRaw ? m.totalSupplyRaw - m.totalBorrowRaw : 0n;

  const { warnings, add, blocked } = warningList();
  if (m.oracleStale) add("ORACLE_STALE", "block", "The oracle price is too old to open a position.");
  if (session.session === "CLOSED") add("SESSION_CLOSED", "warn", "The exchange is closed. The closed-market limit applies and prices can gap at the open.");
  else if (session.closedRegime) add("PRE_CLOSE_WINDOW", "warn", "The exchange closes soon. The closed-market limit already applies.");
  if (Math.abs(deviation) > m.maxDeviationBps) add("HIGH_DEVIATION", "block", "The swap price is too far from the oracle price.");
  else if (Math.abs(deviation) * 2 > m.maxDeviationBps) add("HIGH_DEVIATION", "warn", "The swap price is far from the oracle price.");
  if (priceImpact > PRICE_IMPACT_WARN_BPS) add("HIGH_PRICE_IMPACT", "warn", "This size moves the DEX price noticeably.");
  if (ltvWorst > m.currentSoftLtvWad) add("NEAR_SOFT_LIMIT", "block", "This leverage is above the current limit for this market.");
  else if (ltvWorst + (NEAR_SOFT_LIMIT_BPS * WAD) / BPS > m.currentSoftLtvWad) add("NEAR_SOFT_LIMIT", "warn", "This position starts close to the limit.");
  if (collateralValue(collateralAfter, price) > m.maxPositionUsdRaw) add("POSITION_CAP", "block", "The position would be above the size cap for this market.");
  if (borrow > available) add("LOW_LIQUIDITY", "block", "Not enough USDC to borrow in this market right now.");
  if (!m.enabled || session.openingPaused) add("SESSION_CLOSED", "block", "Opening positions is paused for this market.");

  const openData = encodeFunctionData({
    abi: marginRouterAbi,
    functionName: "openLong",
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
      stockAmountRaw: expectedOut.toString(),
      collateralRaw: collateralAfter.toString(),
      debtRaw: debtAfter.toString(),
      execPriceE8: execE8.toString(),
      oraclePriceE8: m.oraclePriceE8.toString(),
      deviationBps: deviation,
      priceImpactBps: priceImpact,
      feeRaw: fee.toString(),
      ltvAfterWad: ltvAfter.toString(),
      liqPriceE8: liqE8.toString(),
      liqDistanceBps: liqDistanceBps(m.oraclePriceE8, liqE8),
      borrowApyWad: borrowApyWad(m.borrowRatePerSecondWad).toString(),
      gapScenarios: gapScenarios("long", m.info.symbol, ltvAfter, m.lltvWad),
    },
    requirements: check.requirements,
    tx: { to: reader.deployment.router, data, value: "0", gasLimit: gasLimit.toString() },
    warnings,
  };
}
