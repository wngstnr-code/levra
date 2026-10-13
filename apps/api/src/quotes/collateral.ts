import { tokens } from "@levra/shared/addresses";
import { marginRouterAbi } from "@levra/shared/abis";
import type { QuoteCollateralRequest, QuoteCollateralResponse } from "@levra/shared/api";
import { cautiousPriceE8, liquidationPriceE8, morphoOraclePrice, positionLtvWad } from "@levra/shared/math";
import { randomUUID } from "node:crypto";
import { encodeFunctionData, type Hex } from "viem";
import type { ChainReader } from "../chain/reader";
import { ApiHttpError, upstream } from "../errors";
import { QUOTE_TTL_SECONDS, liqDistanceBps, tokenDecimals, warningList } from "./common";
import { checkRequirements } from "./requirements";
import { simulate } from "./simulate";

export async function quoteCollateral(reader: ChainReader, req: QuoteCollateralRequest): Promise<QuoteCollateralResponse> {
  const amount = BigInt(req.amountRaw);
  if (amount === 0n) throw new ApiHttpError("BAD_REQUEST", "Amount must be above zero.");

  const [markets, block, positions] = await Promise.all([
    upstream(reader.markets),
    upstream(reader.latestBlock),
    upstream(() => reader.positions(req.user, { fresh: true })),
  ]);
  const m = markets.find((x) => x.info.marketId.toLowerCase() === req.marketId.toLowerCase());
  if (!m) throw new ApiHttpError("NOT_FOUND", "Unknown market.");
  const pos = positions.find((p) => p.marketId.toLowerCase() === req.marketId.toLowerCase());
  const collateral = pos?.collateralRaw ?? 0n;
  const debt = pos?.debtRaw ?? 0n;

  const side = m.info.side;
  const collateralToken = m.info.collateralToken;
  const stock = m.info.stock.token;
  const [quoteDecimals, stockDecimals] = (await upstream(() => tokenDecimals(reader, [tokens.USDC.address, stock]))) as [number, number];

  const removing = req.action === "remove";
  const repaying = req.action === "repay";
  if (removing && amount > collateral) throw new ApiHttpError("BAD_REQUEST", "Cannot remove more collateral than the position holds.");
  if (repaying && debt === 0n) throw new ApiHttpError("BAD_REQUEST", "There is no debt to repay in this market.");
  const collateralAfter = removing ? collateral - amount : repaying ? collateral : collateral + amount;
  // repayDebt never takes more than the debt (D-32).
  const repaid = repaying ? (amount < debt ? amount : debt) : 0n;
  const debtAfter = debt - repaid;

  const price = morphoOraclePrice(side, cautiousPriceE8(side, { priceE8: m.oraclePriceE8, bidE8: m.bidE8, askE8: m.askE8 }), stockDecimals, quoteDecimals);
  const ltvAfter = positionLtvWad(debtAfter, collateralAfter, price);
  const liqE8 = liquidationPriceE8(side, { collateral: collateralAfter, debt: debtAfter, lltvWad: m.lltvWad, stockDecimals, quoteDecimals });

  const { warnings, add, blocked } = warningList();
  if (removing && debt > 0n && m.oracleHardStale) add("ORACLE_STALE", "block", "Morpho cannot price this market right now, so collateral cannot be removed.");
  if (removing && ltvAfter > m.currentSoftLtvWad) add("NEAR_SOFT_LIMIT", "block", "Removing this much would put the position above the limit.");

  const actionData = encodeFunctionData({
    abi: marginRouterAbi,
    functionName: removing ? "removeCollateral" : repaying ? "repayDebt" : "addCollateral",
    args: [m.info.marketId, amount],
  });
  const pulled = repaying ? m.info.loanToken : collateralToken;
  const check = await upstream(() =>
    checkRequirements(reader, {
      user: req.user,
      // Only USDC has permit; the stock tokens need a normal approve (05, Q-18).
      ...(removing
        ? {}
        : { pull: { token: pulled, amount: repaying ? repaid : amount, permit: pulled.toLowerCase() === tokens.USDC.address.toLowerCase() } }),
      authorization: removing,
      signatures: req.signatures,
      blockTime: block.time,
    }),
  );
  const data: Hex = check.preCalls.length
    ? encodeFunctionData({ abi: marginRouterAbi, functionName: "multicall", args: [[...check.preCalls, actionData]] })
    : actionData;

  let gasLimit = 0n;
  if (!blocked() && check.ready && check.funded) {
    const sim = await simulate(reader.client, { from: req.user, to: reader.deployment.router, data });
    gasLimit = sim.gasLimit;
    if (sim.warning) warnings.push(sim.warning);
  }

  return {
    quoteId: randomUUID(),
    expiresAt: block.time + QUOTE_TTL_SECONDS,
    preview: {
      collateralAfterRaw: collateralAfter.toString(),
      ltvAfterWad: ltvAfter.toString(),
      liqPriceE8: liqE8.toString(),
      liqDistanceBps: liqDistanceBps(m.oraclePriceE8, liqE8),
    },
    requirements: check.requirements,
    tx: { to: reader.deployment.router, data, value: "0", gasLimit: gasLimit.toString() },
    warnings,
  };
}
