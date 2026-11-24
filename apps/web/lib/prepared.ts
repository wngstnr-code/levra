import type { PreparedResponse } from "@levra/shared/api";
import { formatUnits } from "viem";

const WAD = 10n ** 18n;

/**
 * Where a prepared action is reviewed and signed: the usual trade or manage screen, filled with the agent's request
 * (BE-77). The screen quotes it again, so the user signs a fresh quote, never the stored one.
 */
export function preparedPath(p: PreparedResponse): string {
  const q = new URLSearchParams({ agent: p.id });
  if (p.kind === "open") {
    const r = p.request;
    q.set("symbol", r.symbol);
    q.set("side", r.side);
    q.set("margin", formatUnits(BigInt(r.marginRaw), 6));
    q.set("leverage", String(r.leverageE2));
    q.set("slippage", String(r.slippageBps));
    return `/trade?${q.toString()}`;
  }
  q.set("manage", p.request.marketId);
  if (p.kind === "close") {
    // Percent with two decimals, so 33.33% stays 33.33%.
    const pct = Number((BigInt(p.request.fractionWad) * 10_000n) / WAD) / 100;
    q.set("action", pct >= 100 ? "close" : "reduce");
    q.set("fraction", String(pct));
  } else {
    q.set("action", p.request.action);
    q.set("amountRaw", p.request.amountRaw);
  }
  return `/positions?${q.toString()}`;
}

/** The connected wallet must be the one the agent prepared for. */
export function sameWallet(a: string | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

/** Slippage choices the trade screen offers (basis points). A link can only pick one of them. */
export const SLIPPAGE_CHOICES = [30, 50, 100] as const;

export function slippageFromParam(value: string | null): number {
  const n = Number(value);
  return (SLIPPAGE_CHOICES as readonly number[]).includes(n) ? n : 50;
}

/** A close fraction from a link, in percent with two decimals, kept between 1 and 100. */
export function fractionFromParam(value: string | null): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(100, Math.max(1, Math.round(n * 100) / 100));
}
