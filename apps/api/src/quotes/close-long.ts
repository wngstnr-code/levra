import { marginRouterAbi } from "@levra/shared/abis";
import type { QuoteCloseRequest, QuoteCloseResponse } from "@levra/shared/api";
import { BPS, MAX_UINT256, WAD, cautiousPriceE8, morphoOraclePrice, positionLtvWad, signedDeviationBps } from "@levra/shared/math";
import { randomUUID } from "node:crypto";
import { encodeFunctionData, type Hex } from "viem";
import { ApiHttpError, upstream } from "../errors";
import { longCostBasis, realizedOnReduce } from "../positions/cost-basis";
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
import { simulate } from "./simulate";

/** Debt keeps accruing between the quote and the transaction. 1 bps of the debt covers far more than 20 seconds. */
const DEBT_BUFFER_BPS = 1n;

export async function quoteCloseLong({ reader, swap, events: store }: QuoteDeps, req: QuoteCloseRequest): Promise<QuoteCloseResponse> {
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
  if (m.info.side !== "long") throw new ApiHttpError("BAD_REQUEST", "This is not a long market.");
  const pos = positions.find((p) => p.marketId.toLowerCase() === req.marketId.toLowerCase());
  if (!pos || pos.collateralRaw === 0n) throw new ApiHttpError("NOT_FOUND", "No position in this market.");

  const quote = m.info.loanToken;
  const stock = m.info.collateralToken;
  const [quoteDecimals, stockDecimals] = (await upstream(() => tokenDecimals(reader, [quote, stock]))) as [number, number];

  const full = fraction === WAD;
  const withdraw = full ? pos.collateralRaw : (pos.collateralRaw * fraction) / WAD;
  const debtRepaid = full ? pos.debtRaw : (pos.debtRaw * fraction) / WAD;
  const repayShares = full ? MAX_UINT256 : ((await upstream(() => reader.borrowShares(m.info.marketId, req.user))) * fraction) / WAD;
  if (withdraw === 0n) throw new ApiHttpError("BAD_REQUEST", "This fraction sells nothing.");

  const [route, midE8] = await Promise.all([
    swap.quote({ tokenIn: stock, tokenOut: quote, amountIn: withdraw, sender: reader.deployment.router, slippageBps: req.slippageBps }),
    midPriceE8(swap, quote, stock, quoteDecimals, stockDecimals, m.oraclePriceE8),
  ]);
  const proceeds = route.amountOut;
  const minProceeds = (proceeds * (BPS - BigInt(req.slippageBps))) / BPS;
  const fee = (proceeds * fees.feeBps) / BPS;
  const returned = proceeds - fee - debtRepaid;
  const debtBuffer = (debtRepaid * DEBT_BUFFER_BPS) / BPS + 1n;
  const minReturnRaw = minProceeds - (minProceeds * fees.feeBps) / BPS - debtRepaid - debtBuffer;
  const minReturn = minReturnRaw > 0n ? minReturnRaw : 0n;

  const execE8 = execPriceE8(proceeds, withdraw, quoteDecimals, stockDecimals);
  const price = morphoOraclePrice("long", cautiousPriceE8("long", { priceE8: m.oraclePriceE8, bidE8: m.bidE8, askE8: m.askE8 }), stockDecimals, quoteDecimals);
  const ltvAfter = full ? 0n : positionLtvWad(pos.debtRaw - debtRepaid, pos.collateralRaw - withdraw, price);
  const deviation = signedDeviationBps(execE8, m.oraclePriceE8);
  const priceImpact = -signedDeviationBps(execE8, midE8);

  const { warnings, add, blocked } = warningList();
  if (!full && m.oracleHardStale) add("ORACLE_STALE", "block", "Morpho cannot price this market right now, so a partial close would fail. A full close still works.");
  if (returned < 0n) add("HIGH_PRICE_IMPACT", "block", "Selling this share of the stock would not cover the debt it repays.");
  if (Math.abs(deviation) * 2 > m.maxDeviationBps) add("HIGH_DEVIATION", "warn", "The swap price is far from the oracle price.");
  if (priceImpact > PRICE_IMPACT_WARN_BPS) add("HIGH_PRICE_IMPACT", "warn", "This size moves the DEX price noticeably.");
  if (!full && ltvAfter > pos.ltvWad && ltvAfter > m.currentSoftLtvWad) add("NEAR_SOFT_LIMIT", "block", "This reduction would leave the position above the limit.");

  const closeData = encodeFunctionData({
    abi: marginRouterAbi,
    functionName: "closeLong",
    args: [
      {
        marketId: m.info.marketId,
        repayShares,
        withdrawAssets: full ? MAX_UINT256 : withdraw,
        swapAmountIn: full ? MAX_UINT256 : withdraw,
        swap: { target: route.target, data: route.data, minOut: minProceeds },
        minReturn,
        deadline: BigInt(block.time + TX_DEADLINE_SECONDS),
      },
    ],
  });

  const check = await upstream(() => checkRequirements(reader, { user: req.user, authorization: true, blockTime: block.time }));
  const data: Hex = closeData;

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
      stockAmountRaw: withdraw.toString(),
      debtRepaidRaw: debtRepaid.toString(),
      collateralWithdrawnRaw: withdraw.toString(),
      returnedRaw: settled.toString(),
      execPriceE8: execE8.toString(),
      oraclePriceE8: m.oraclePriceE8.toString(),
      deviationBps: deviation,
      priceImpactBps: priceImpact,
      feeRaw: fee.toString(),
      ltvAfterWad: ltvAfter.toString(),
      realizedPnlUsdRaw: realizedOnReduce(longCostBasis(toCostEvents(events), m.info.marketId), withdraw, settled).toString(),
    },
    requirements: check.requirements,
    tx: { to: reader.deployment.router, data, value: "0", gasLimit: gasLimit.toString() },
    warnings,
  };
}
