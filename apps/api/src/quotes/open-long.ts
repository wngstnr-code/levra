import { marginRouterAbi } from "@levra/shared/abis";
import type { GapScenario, QuoteOpenRequest, QuoteOpenResponse, Warning } from "@levra/shared/api";
import { gapTable } from "@levra/shared/gaps";
import {
  BPS,
  borrowApyWad,
  cautiousPriceE8,
  collateralValue,
  liquidationPriceE8,
  ltvAfterGapWad,
  morphoOraclePrice,
  mulDiv,
  positionLtvWad,
  signedDeviationBps,
} from "@levra/shared/math";
import { randomUUID } from "node:crypto";
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import type { ChainReader, MarketState } from "../chain/reader";
import { ApiHttpError, upstream } from "../errors";
import { toApiMarket } from "../routes/markets";
import type { SwapSource } from "../swap/kyber";
import { checkRequirements } from "./requirements";
import { simulate } from "./simulate";

/** Initial proposals (04 and 03). */
export const QUOTE_TTL_SECONDS = 20;
const TX_DEADLINE_SECONDS = 120;
const PRICE_IMPACT_WARN_BPS = 100;
const NEAR_SOFT_LIMIT_BPS = 200n;
/** Size of the reference swap for the DEX mid price: 10 USDC. */
const MID_PRICE_PROBE_RAW = 10_000_000n;

export type QuoteDeps = { reader: ChainReader; swap: SwapSource };

/** MarginRouter._priceE8: quote token per stock token as a dollar price with 8 decimals. */
function execPriceE8(quoteAmount: bigint, stockAmount: bigint, quoteDecimals: number, stockDecimals: number): bigint {
  return mulDiv(quoteAmount * 100_000_000n, 10n ** BigInt(stockDecimals), stockAmount * 10n ** BigInt(quoteDecimals));
}

function gapScenarios(symbol: string, ltvWad: bigint, lltvWad: bigint): GapScenario[] {
  const gap = gapTable[symbol as keyof typeof gapTable];
  if (!gap || ltvWad === 0n) return [];
  const ltvAfter = ltvAfterGapWad("long", ltvWad, (BigInt(gap.worstDropBps) * 10n ** 18n) / BPS);
  return [{ label: "Worst weekend or holiday gap in 5 years", moveBps: gap.worstDropBps, ltvWad: ltvAfter.toString(), liquidated: ltvAfter >= lltvWad }];
}

async function decimals(reader: ChainReader, token: Address): Promise<number> {
  return reader.client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
}

export async function quoteOpenLong({ reader, swap }: QuoteDeps, req: QuoteOpenRequest): Promise<QuoteOpenResponse> {
  const margin = BigInt(req.marginRaw);
  if (margin === 0n) throw new ApiHttpError("BAD_REQUEST", "Margin must be above zero.");
  if (req.leverageE2 < 100) throw new ApiHttpError("BAD_REQUEST", "Leverage must be at least 1x (100).");

  const [markets, session, fees, block, positions] = await Promise.all([
    upstream(reader.markets),
    upstream(reader.session),
    upstream(reader.routerFees),
    upstream(reader.latestBlock),
    upstream(() => reader.positions(req.user)),
  ]);
  const m = markets.find((x: MarketState) => x.info.symbol === req.symbol && x.info.side === "long");
  if (!m) throw new ApiHttpError("NOT_FOUND", `No long market for ${req.symbol}.`);

  const quote = m.info.loanToken;
  const stock = m.info.collateralToken;
  const [quoteDecimals, stockDecimals] = await upstream(() => Promise.all([decimals(reader, quote), decimals(reader, stock)]));

  const gross = (margin * BigInt(req.leverageE2)) / 100n;
  const borrow = gross - margin;
  const fee = (gross * fees.feeBps) / BPS;
  const swapIn = gross - fee;

  const [route, probeOut] = await Promise.all([
    swap.quote({ tokenIn: quote, tokenOut: stock, amountIn: swapIn, sender: reader.deployment.router, slippageBps: req.slippageBps }),
    swap.price({ tokenIn: quote, tokenOut: stock, amountIn: MID_PRICE_PROBE_RAW }),
  ]);
  const expectedOut = route.amountOut;
  const minOut = (expectedOut * (BPS - BigInt(req.slippageBps))) / BPS;
  const execE8 = execPriceE8(swapIn, expectedOut, quoteDecimals, stockDecimals);
  const midE8 = execPriceE8(MID_PRICE_PROBE_RAW, probeOut, quoteDecimals, stockDecimals);

  const existing = positions.find((p) => p.marketId.toLowerCase() === m.info.marketId.toLowerCase());
  const collateralAfter = (existing?.collateralRaw ?? 0n) + expectedOut;
  const debtAfter = (existing?.debtRaw ?? 0n) + borrow;
  const price = morphoOraclePrice("long", cautiousPriceE8("long", { priceE8: m.oraclePriceE8, bidE8: m.bidE8, askE8: m.askE8 }), stockDecimals, quoteDecimals);
  const ltvAfter = positionLtvWad(debtAfter, collateralAfter, price);
  const ltvWorst = positionLtvWad(debtAfter, (existing?.collateralRaw ?? 0n) + minOut, price);
  const liqE8 = liquidationPriceE8("long", { collateral: collateralAfter, debt: debtAfter, lltvWad: m.lltvWad, stockDecimals, quoteDecimals });
  const liqDistanceBps = liqE8 === 0n ? 10_000 : Number(((m.oraclePriceE8 - liqE8) * BPS) / m.oraclePriceE8);
  const deviation = signedDeviationBps(execE8, m.oraclePriceE8);
  const priceImpact = signedDeviationBps(execE8, midE8);
  const available = m.totalSupplyRaw > m.totalBorrowRaw ? m.totalSupplyRaw - m.totalBorrowRaw : 0n;

  const warnings: Warning[] = [];
  const add = (code: Warning["code"], severity: Warning["severity"], message: string) => warnings.push({ code, severity, message });
  if (m.oracleStale) add("ORACLE_STALE", "block", "The oracle price is too old to open a position.");
  if (session.session === "CLOSED") add("SESSION_CLOSED", "warn", "The exchange is closed. The closed-market limit applies and prices can gap at the open.");
  else if (session.closedRegime) add("PRE_CLOSE_WINDOW", "warn", "The exchange closes soon. The closed-market limit already applies.");
  if (Math.abs(deviation) > m.maxDeviationBps) add("HIGH_DEVIATION", "block", "The swap price is too far from the oracle price.");
  else if (Math.abs(deviation) * 2 > m.maxDeviationBps) add("HIGH_DEVIATION", "warn", "The swap price is far from the oracle price.");
  if (priceImpact > PRICE_IMPACT_WARN_BPS) add("HIGH_PRICE_IMPACT", "warn", "This size moves the DEX price noticeably.");
  if (ltvWorst > m.currentSoftLtvWad) add("NEAR_SOFT_LIMIT", "block", "This leverage is above the current limit for this market.");
  else if (ltvWorst + (NEAR_SOFT_LIMIT_BPS * 10n ** 18n) / BPS > m.currentSoftLtvWad) add("NEAR_SOFT_LIMIT", "warn", "This position starts close to the limit.");
  if (collateralValue(collateralAfter, price) > m.maxPositionUsdRaw) add("POSITION_CAP", "block", "The position would be above the size cap for this market.");
  if (borrow > available) add("LOW_LIQUIDITY", "block", "Not enough USDC to borrow in this market right now.");
  if (!m.enabled || session.openingPaused) add("SESSION_CLOSED", "block", "Opening positions is paused for this market.");

  const deadline = BigInt(block.time + TX_DEADLINE_SECONDS);
  const openData = encodeFunctionData({
    abi: marginRouterAbi,
    functionName: "openLong",
    args: [{ marketId: m.info.marketId, margin, borrowAssets: borrow, swap: { target: route.target, data: route.data, minOut }, maxLtv: ltvWorst, deadline }],
  });

  const check = await upstream(() => checkRequirements(reader, { user: req.user, token: quote, amount: margin, signatures: req.signatures, blockTime: block.time }));
  const data: Hex = check.preCalls.length
    ? encodeFunctionData({ abi: marginRouterAbi, functionName: "multicall", args: [[...check.preCalls, openData]] })
    : openData;

  let gasLimit = 0n;
  const blocked = warnings.some((w) => w.severity === "block");
  if (!blocked && check.ready && check.funded) {
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
      liqDistanceBps,
      borrowApyWad: borrowApyWad(m.borrowRatePerSecondWad).toString(),
      gapScenarios: gapScenarios(m.info.symbol, ltvAfter, m.lltvWad),
    },
    requirements: check.requirements,
    tx: { to: reader.deployment.router, data, value: "0", gasLimit: gasLimit.toString() },
    warnings,
  };
}
