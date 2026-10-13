import type { DepositToken } from "@levra/shared/api";

// The service lists about 200 tokens in no useful order. Where people usually hold USDC comes first.
const CHAIN_ORDER = ["Ethereum", "Base", "Arbitrum", "BNB Chain", "Polygon", "Optimism", "Avalanche", "Solana"];
const TOKEN_ORDER = ["USDC", "USDT"];

const rank = (list: string[], v: string) => {
  const i = list.indexOf(v);
  return i === -1 ? list.length : i;
};

/** Common chains first, then the rest by name; on each chain USDC, then USDT, then the service's order. */
export function orderDepositTokens(tokens: DepositToken[]): DepositToken[] {
  return tokens
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        rank(CHAIN_ORDER, a.t.chainName) - rank(CHAIN_ORDER, b.t.chainName) ||
        a.t.chainName.localeCompare(b.t.chainName) ||
        rank(TOKEN_ORDER, a.t.symbol.toUpperCase()) - rank(TOKEN_ORDER, b.t.symbol.toUpperCase()) ||
        a.i - b.i,
    )
    .map(({ t }) => t);
}
