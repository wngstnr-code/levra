import { morphoAbi } from "@levra/shared/abis";
import type { Account, GapScenario, HistoryItem, HistoryItemType, Position } from "@levra/shared/api";
import { gapTable } from "@levra/shared/gaps";
import { BPS, ORACLE_PRICE_SCALE, WAD, cautiousPriceE8, collateralValue, ltvAfterGapWad, morphoOraclePrice, mulDiv } from "@levra/shared/math";
import { external, tokens } from "@levra/shared/addresses";
import { erc20Abi, type Address } from "viem";
import type { ChainReader, MarketState } from "../chain/reader";
import { emptyCostBasis, entryPriceE8, longCostBasis, realizedOnReduce, type CostBasis } from "./cost-basis";
import { toCostEvents, type StoredEvent } from "./events";

const STOCK_DECIMALS = 18;
const QUOTE_DECIMALS = tokens.USDC.decimals;

export function gapScenarios(side: "long" | "short", symbol: string, ltvWad: bigint, lltvWad: bigint): GapScenario[] {
  const gap = gapTable[symbol as keyof typeof gapTable];
  if (!gap || ltvWad === 0n) return [];
  const move = side === "long" ? gap.worstDropBps : gap.worstRiseBps;
  const ltvAfter = ltvAfterGapWad(side, ltvWad, (BigInt(move) * WAD) / BPS);
  const label = side === "long" ? "Worst weekend or holiday drop in 5 years" : "Worst weekend or holiday rise in 5 years";
  return [{ label, moveBps: move, ltvWad: ltvAfter.toString(), liquidated: ltvAfter >= lltvWad }];
}

function liqDistance(oracleE8: bigint, liqE8: bigint, side: "long" | "short"): number {
  if (liqE8 === 0n || oracleE8 === 0n) return Number(BPS);
  const diff = side === "long" ? oracleE8 - liqE8 : liqE8 - oracleE8;
  return Number((diff * BPS) / oracleE8);
}

/**
 * Builds the account from live chain reads (positions through `Lens`) and the indexed router events (entry price, PnL).
 * Short positions show value and equity; their entry price and PnL come with the short quote engine (BE-20) and are 0 until then.
 */
export async function buildAccount(reader: ChainReader, events: StoredEvent[], user: Address): Promise<Account> {
  const [positions, markets, block] = await Promise.all([reader.positions(user), reader.markets(), reader.latestBlock()]);
  const costEvents = toCostEvents(events);
  const walletTokens = [
    { token: tokens.USDC.address, symbol: "USDC" },
    { token: tokens.aQQQ.address, symbol: "aQQQ" },
    { token: tokens.aHOOD.address, symbol: "aHOOD" },
    { token: tokens.aBIL.address, symbol: "aBIL" },
  ] as const;
  const reads = await reader.client.multicall({
    allowFailure: false,
    contracts: [
      ...walletTokens.map((t) => ({ address: t.token, abi: erc20Abi, functionName: "balanceOf", args: [user] }) as const),
      { address: external.morpho, abi: morphoAbi, functionName: "isAuthorized", args: [user, reader.deployment.router] } as const,
    ],
  });

  const out: Position[] = [];
  let equity = 0n;
  let debtUsd = 0n;
  let unrealized = 0n;

  for (const p of positions) {
    const m = markets.find((x: MarketState) => x.info.marketId.toLowerCase() === p.marketId.toLowerCase());
    if (!m) continue;
    const side = m.info.side;
    const price = morphoOraclePrice(side, cautiousPriceE8(side, { priceE8: m.oraclePriceE8, bidE8: m.bidE8, askE8: m.askE8 }), STOCK_DECIMALS, QUOTE_DECIMALS);
    const basis: CostBasis = side === "long" ? longCostBasis(costEvents, m.info.marketId) : emptyCostBasis();

    const value = side === "long" ? collateralValue(p.collateralRaw, price) : mulDiv(p.debtRaw, ORACLE_PRICE_SCALE, price);
    const positionDebtUsd = side === "long" ? p.debtRaw : value;
    const positionEquity = side === "long" ? value - p.debtRaw : p.collateralRaw - value;
    const pnl = side === "long" && basis.shares > 0n ? positionEquity - basis.invested : 0n;

    equity += positionEquity;
    debtUsd += positionDebtUsd;
    unrealized += pnl;
    out.push({
      marketId: m.info.marketId,
      symbol: m.info.symbol,
      side,
      stockAmountRaw: (side === "long" ? p.collateralRaw : p.debtRaw).toString(),
      collateralRaw: p.collateralRaw.toString(),
      debtRaw: p.debtRaw.toString(),
      valueUsdRaw: value.toString(),
      equityUsdRaw: positionEquity.toString(),
      entryPriceE8: entryPriceE8(basis, QUOTE_DECIMALS, STOCK_DECIMALS).toString(),
      oraclePriceE8: m.oraclePriceE8.toString(),
      unrealizedPnlUsdRaw: pnl.toString(),
      ltvWad: p.ltvWad.toString(),
      softLtvWad: p.softLtvWad.toString(),
      lltvWad: p.lltvWad.toString(),
      liqPriceE8: p.liqPriceE8.toString(),
      liqDistanceBps: liqDistance(m.oraclePriceE8, p.liqPriceE8, side),
      protection: p.protection,
      overSoftLimit: p.ltvWad > p.softLtvWad,
      gapScenarios: gapScenarios(side, m.info.symbol, p.ltvWad, p.lltvWad),
    });
  }

  return {
    address: user,
    positions: out,
    totals: { equityUsdRaw: equity.toString(), debtUsdRaw: debtUsd.toString(), unrealizedPnlUsdRaw: unrealized.toString() },
    walletBalances: walletTokens.map((t, i) => ({ token: t.token, symbol: t.symbol, balanceRaw: (reads[i] as bigint).toString() })),
    morphoAuthorized: reads[walletTokens.length] as boolean,
    updatedAtBlock: Number(block.number),
  };
}

/** History items from router events, newest first, with the realized PnL of each reduction at the time it happened. */
export function buildHistory(reader: ChainReader, events: StoredEvent[]): HistoryItem[] {
  const markets = new Map(reader.deployment.markets.map((m) => [m.marketId.toLowerCase(), m]));
  const items: HistoryItem[] = [];

  for (const [i, e] of events.entries()) {
    const market = markets.get(e.marketId.toLowerCase());
    if (!market) continue;
    const side = market.side;
    const big = (k: string) => BigInt(String(e.args[k] ?? "0"));
    const base = {
      id: `${e.txHash}:${e.logIndex}`,
      marketId: market.marketId,
      symbol: market.symbol,
      side,
      txHash: e.txHash,
      timestamp: e.blockTime,
    };

    if (e.name === "PositionOpened") {
      items.push({
        ...base,
        type: "open",
        stockAmountRaw: (side === "long" ? big("collateralDelta") : big("debtDelta")).toString(),
        usdAmountRaw: big("margin").toString(),
        execPriceE8: big("execPriceE8").toString(),
        feeRaw: big("fee").toString(),
        realizedPnlUsdRaw: null,
      });
    } else if (e.name === "PositionReduced") {
      const before = side === "long" ? longCostBasis(toCostEvents(events.slice(0, i)), market.marketId) : emptyCostBasis();
      const sold = big("collateralDelta");
      const type: HistoryItemType = Number(e.args.reason) === 1 ? "autoReduce" : before.shares > 0n && sold >= before.shares ? "close" : "reduce";
      items.push({
        ...base,
        type,
        stockAmountRaw: (side === "long" ? sold : big("debtDelta")).toString(),
        usdAmountRaw: big("returned").toString(),
        execPriceE8: big("execPriceE8").toString(),
        feeRaw: big("fee").toString(),
        realizedPnlUsdRaw: side === "long" ? realizedOnReduce(before, sold, big("returned")).toString() : null,
      });
    } else if (e.name === "DebtRepaid") {
      const amount = big("assets").toString();
      items.push({
        ...base,
        type: "repayDebt",
        stockAmountRaw: side === "short" ? amount : null,
        usdAmountRaw: side === "long" ? amount : null,
        execPriceE8: null,
        feeRaw: null,
        realizedPnlUsdRaw: null,
      });
    } else if (e.name === "CollateralAdded" || e.name === "CollateralRemoved") {
      const amount = big("assets").toString();
      items.push({
        ...base,
        type: e.name === "CollateralAdded" ? "addCollateral" : "removeCollateral",
        stockAmountRaw: side === "long" ? amount : null,
        usdAmountRaw: side === "short" ? amount : null,
        execPriceE8: null,
        feeRaw: null,
        realizedPnlUsdRaw: null,
      });
    }
  }
  return items.reverse();
}

export type HistoryPage = { items: HistoryItem[]; nextCursor: string | null };

/** Cursor is the id of the last item already shown. */
export function pageHistory(all: HistoryItem[], cursor: string | undefined, limit: number): HistoryPage {
  const at = cursor ? all.findIndex((x) => x.id === cursor) : -1;
  if (cursor && at < 0) throw new RangeError("Unknown history cursor");
  const start = at + 1;
  const items = all.slice(start, start + limit);
  const last = items.at(-1);
  return { items, nextCursor: last && start + limit < all.length ? last.id : null };
}

