import { morphoAbi } from "@levra/shared/abis";
import type { Account, HistoryItem, HistoryItemType, Position } from "@levra/shared/api";
import { gapScenarios } from "@levra/shared/gaps";
import { BPS, ORACLE_PRICE_SCALE, cautiousPriceE8, collateralValue, morphoOraclePrice, mulDiv, pnlBps } from "@levra/shared/math";
import { isChainId } from "@levra/shared/chains";
import { stocksByChain } from "@levra/shared/markets";
import { erc20Abi, type Address, type Hex } from "viem";
import type { ChainReader, MarketState } from "../chain/reader";
import { costBasis, entryPriceE8, longCostBasis, realizedOnReduce, type CostBasis } from "./cost-basis";
import { toCostEvents, type StoredEvent } from "./events";

/**
 * History items need a market id and a symbol. Vault deposits and withdrawals have no market, so they carry the zero id
 * and the symbol `USDC` (BE-22). The frontend tells them apart by `marketId`.
 */
export const VAULT_HISTORY_MARKET_ID: Hex = `0x${"00".repeat(32)}`;

/** One helper for both sides (BE-34), kept under its old name for callers. */
export { gapScenarios };

function liqDistance(oracleE8: bigint, liqE8: bigint, side: "long" | "short"): number {
  if (liqE8 === 0n || oracleE8 === 0n) return Number(BPS);
  const diff = side === "long" ? oracleE8 - liqE8 : liqE8 - oracleE8;
  return Number((diff * BPS) / oracleE8);
}

/**
 * Builds the account from live chain reads (positions through `Lens`) and the indexed router events (entry price, PnL).
 * Long and short both get an entry price and PnL from the router events (BE-20); a position built straight on Morpho has none.
 */
export async function buildAccount(reader: ChainReader, events: StoredEvent[], user: Address): Promise<Account> {
  const [positions, markets, block] = await Promise.all([reader.positions(user), reader.markets(), reader.latestBlock()]);
  const costEvents = toCostEvents(events);
  const chainId = reader.deployment.chainId;
  if (!isChainId(chainId)) throw new Error(`Deployment is for chain ${chainId}, which has no addresses in packages/shared`);
  const walletTokens = [
    { token: reader.usdc.address, symbol: "USDC" },
    ...Object.values(stocksByChain[chainId]).map((s) => ({ token: s.token, symbol: s.tokenSymbol })),
  ];
  const reads = await reader.client.multicall({
    allowFailure: false,
    contracts: [
      ...walletTokens.map((t) => ({ address: t.token, abi: erc20Abi, functionName: "balanceOf", args: [user] }) as const),
      { address: reader.morpho, abi: morphoAbi, functionName: "isAuthorized", args: [user, reader.deployment.router] } as const,
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
    const basis: CostBasis = costBasis(side, costEvents, m.info.marketId);
    // Without an oracle price (BE-99) the position has no value, equity or PnL to show, and the totals leave it out.
    const priced = m.oraclePriceE8 > 0n;
    let value = 0n;
    let positionEquity = 0n;
    let pnl = 0n;
    if (priced) {
      const price = morphoOraclePrice(side, cautiousPriceE8(side, { priceE8: m.oraclePriceE8, bidE8: m.bidE8, askE8: m.askE8 }), m.info.stock.decimals, reader.usdc.decimals);
      value = side === "long" ? collateralValue(p.collateralRaw, price) : mulDiv(p.debtRaw, ORACLE_PRICE_SCALE, price);
      positionEquity = side === "long" ? value - p.debtRaw : p.collateralRaw - value;
      pnl = basis.shares > 0n ? positionEquity - basis.invested : 0n;
      equity += positionEquity;
      debtUsd += side === "long" ? p.debtRaw : value;
      unrealized += pnl;
    }
    out.push({
      marketId: m.info.marketId,
      symbol: m.info.symbol,
      side,
      stockAmountRaw: (side === "long" ? p.collateralRaw : p.debtRaw).toString(),
      collateralRaw: p.collateralRaw.toString(),
      debtRaw: p.debtRaw.toString(),
      valueUsdRaw: value.toString(),
      equityUsdRaw: positionEquity.toString(),
      entryPriceE8: entryPriceE8(basis, reader.usdc.decimals, m.info.stock.decimals).toString(),
      oraclePriceE8: m.oraclePriceE8.toString(),
      unrealizedPnlUsdRaw: pnl.toString(),
      pnlBps: priced && basis.shares > 0n ? pnlBps(pnl, basis.invested) : null,
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
  const routerTxs = new Set(events.filter((e) => e.source === "router").map((e) => e.txHash.toLowerCase()));
  /** Borrow shares per market from Morpho events seen so far. Morpho logs before the router in the same transaction. */
  const shares = new Map<string, bigint>();

  for (const [i, e] of events.entries()) {
    if (e.source === "vault") {
      const assets = String(e.args.assets ?? "0");
      items.push({
        id: `${e.txHash}:${e.logIndex}`,
        type: e.name === "Deposit" ? "lend" : "withdrawLend",
        marketId: VAULT_HISTORY_MARKET_ID,
        symbol: "USDC",
        side: null,
        txHash: e.txHash,
        timestamp: e.blockTime,
        stockAmountRaw: null,
        usdAmountRaw: assets,
        execPriceE8: null,
        feeRaw: null,
        realizedPnlUsdRaw: null,
      });
      continue;
    }
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

    if (e.source === "morpho") {
      const delta = borrowSharesDelta(e);
      if (delta !== null) shares.set(market.marketId, (shares.get(market.marketId) ?? 0n) + delta);
      const item = morphoHistoryItem(e, side, routerTxs, () => costBasis(side, toCostEvents(events.slice(0, i)), market.marketId));
      if (item) items.push({ ...base, ...item });
      continue;
    }

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
      const before = costBasis(side, toCostEvents(events.slice(0, i)), market.marketId);
      // The stock leaving the position: sold collateral for a long, repaid debt for a short.
      const sold = side === "long" ? big("collateralDelta") : big("debtDelta");
      // With Morpho events indexed, a reduction that leaves no borrow shares closed the position, for long and short.
      const closed = shares.has(market.marketId) ? shares.get(market.marketId) === 0n : before.shares > 0n && sold >= before.shares;
      const type: HistoryItemType = Number(e.args.reason) === 1 ? "autoReduce" : closed ? "close" : "reduce";
      items.push({
        ...base,
        type,
        stockAmountRaw: sold.toString(),
        usdAmountRaw: big("returned").toString(),
        execPriceE8: big("execPriceE8").toString(),
        feeRaw: big("fee").toString(),
        realizedPnlUsdRaw: realizedOnReduce(before, sold, big("returned")).toString(),
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

/** Change in the owner's borrow shares from one Morpho event, or null when the event does not touch them. */
function borrowSharesDelta(e: StoredEvent): bigint | null {
  const v = (k: string) => BigInt(String(e.args[k] ?? "0"));
  if (e.name === "Borrow") return v("shares");
  if (e.name === "Repay") return -v("shares");
  if (e.name === "Liquidate") return -(v("repaidShares") + v("badDebtShares"));
  return null;
}

type ItemBody = Omit<HistoryItem, "id" | "marketId" | "symbol" | "txHash" | "timestamp">;

/**
 * History for a Morpho event. A liquidation always shows; other actions show only when no router event shares the
 * transaction, which means the user acted on Morpho directly. Lending has no side.
 */
function morphoHistoryItem(e: StoredEvent, side: "long" | "short", routerTxs: Set<string>, basisBefore: () => CostBasis): ItemBody | null {
  const big = (k: string) => BigInt(String(e.args[k] ?? "0"));
  const none = { execPriceE8: null, feeRaw: null, realizedPnlUsdRaw: null };
  const stockIf = (onSide: "long" | "short", amount: bigint) => (side === onSide ? amount.toString() : null);

  if (e.name === "Liquidate") {
    const seized = big("seizedAssets");
    const repaid = big("repaidAssets");
    return {
      type: "liquidation",
      side,
      stockAmountRaw: (side === "long" ? seized : repaid).toString(),
      usdAmountRaw: (side === "long" ? repaid : seized).toString(),
      execPriceE8: null,
      feeRaw: null,
      realizedPnlUsdRaw: realizedOnReduce(basisBefore(), side === "long" ? seized : repaid, 0n).toString(),
    };
  }
  if (routerTxs.has(e.txHash.toLowerCase())) return null;

  const assets = big("assets");
  switch (e.name) {
    case "SupplyCollateral":
      return { type: "addCollateral", side, stockAmountRaw: stockIf("long", assets), usdAmountRaw: stockIf("short", assets), ...none };
    case "WithdrawCollateral":
      return { type: "removeCollateral", side, stockAmountRaw: stockIf("long", assets), usdAmountRaw: stockIf("short", assets), ...none };
    case "Borrow":
      return { type: "borrow", side, stockAmountRaw: stockIf("short", assets), usdAmountRaw: stockIf("long", assets), ...none };
    case "Repay":
      return { type: "repayDebt", side, stockAmountRaw: stockIf("short", assets), usdAmountRaw: stockIf("long", assets), ...none };
    case "Supply":
      return { type: "lend", side: null, stockAmountRaw: stockIf("short", assets), usdAmountRaw: stockIf("long", assets), ...none };
    case "Withdraw":
      return { type: "withdrawLend", side: null, stockAmountRaw: stockIf("short", assets), usdAmountRaw: stockIf("long", assets), ...none };
    default:
      return null;
  }
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

