import type { HistoryItem, Position } from "@levra/shared/api";
import { signedDeviationBps } from "@levra/shared/math";
import { formatUsdE8 } from "./format";
import { formatBps, formatUsdSigned } from "./units";

export type ShareCardData = {
  tokenSymbol: string;
  side: "long" | "short";
  chainName: string;
  /** How far the price moved since entry, in the trade's favour when positive. */
  moveText: string;
  moveUp: boolean;
  pnlText: string;
  entryText: string;
  nowText: string;
  /** Replaces entry, now and PnL under the headline, for a closed trade. */
  stats?: [string, string][];
};

/** What the share card shows, from the position the service reports. Only shared formulas are used. */
export function shareCardData(p: Position, tokenSymbol: string, chainName: string): ShareCardData {
  const raw = signedDeviationBps(BigInt(p.oraclePriceE8), BigInt(p.entryPriceE8));
  const inFavour = p.side === "long" ? raw : -raw;
  return {
    tokenSymbol,
    side: p.side,
    chainName,
    moveText: formatBps(inFavour, { signed: true, fractionDigits: 1 }),
    moveUp: inFavour >= 0,
    pnlText: pnlWithPercent(p),
    entryText: formatUsdE8(BigInt(p.entryPriceE8)),
    nowText: formatUsdE8(BigInt(p.oraclePriceE8)),
  };
}

/** A closed trade from history: the realized PnL as the headline, the exit price and the close day below. */
export function closedCardData(item: HistoryItem, tokenSymbol: string, chainName: string, labels: { exit: string; closed: string }, day: string): ShareCardData | null {
  if (item.realizedPnlUsdRaw == null || item.side == null) return null;
  const pnl = BigInt(item.realizedPnlUsdRaw);
  const text = formatUsdSigned(pnl);
  return {
    tokenSymbol,
    side: item.side,
    chainName,
    moveText: text,
    moveUp: pnl >= 0n,
    pnlText: text,
    entryText: "",
    nowText: "",
    stats: [...(item.execPriceE8 ? ([[labels.exit, formatUsdE8(BigInt(item.execPriceE8))]] as [string, string][]) : []), [labels.closed, day]],
  };
}

/** PnL in dollars, with the percent of the margin put in when the service knows it (BE-101). */
export function pnlWithPercent(p: Pick<Position, "unrealizedPnlUsdRaw" | "pnlBps">): string {
  const usd = formatUsdSigned(p.unrealizedPnlUsdRaw);
  return p.pnlBps == null ? usd : `${usd} (${formatBps(p.pnlBps, { signed: true, fractionDigits: 1 })})`;
}

export function postOnXUrl(text: string, link: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`;
}
