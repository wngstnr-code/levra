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
    const pct = Number((BigInt(p.request.fractionWad) * 100n) / WAD);
    q.set("action", pct >= 100 ? "close" : "reduce");
    q.set("fraction", String(Math.max(1, Math.min(100, pct))));
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
