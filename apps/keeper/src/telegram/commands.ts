import {
  account,
  apiError,
  chainsResponse,
  clockCheck,
  gapCheck,
  marketsResponse,
  riskCheck,
  sessionInfo,
  type Position,
  type RiskCheck,
} from "@levra/shared/api";
import type { ChainId } from "@levra/shared/chains";
import { findStock } from "@levra/shared/markets";
import { z } from "zod";

/** The public API, called the way the MCP server calls it (BE-77): no keys, the app quotes again before anyone signs. */
export type LevraApi = { get(path: string): Promise<unknown>; post(path: string, body: unknown): Promise<unknown> };

export class LevraApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

export function levraApi(baseUrl: string): LevraApi {
  const call = async (path: string, init: RequestInit) => {
    const res = await fetch(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = apiError.safeParse(body);
      if (err.success) throw new LevraApiError(err.data.error.code, err.data.error.message);
      throw new LevraApiError("UPSTREAM_ERROR", `The Levra API answered ${res.status}.`);
    }
    return body;
  };
  return {
    get: (path) => call(path, { method: "GET" }),
    post: (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  };
}

/** Initial proposal, the same default as the app: a prepared action is quoted again in the app, where the user can change it. */
export const CHAT_SLIPPAGE_BPS = 50;
/** Telegram refuses messages longer than 4096 characters. */
const MAX_MESSAGE = 4_000;
const USDC_DECIMALS = 6;

export const HELP = [
  "Levra commands:",
  "/positions: your positions on every chain",
  "/session: the US market session on every chain",
  "/open SYMBOL long|short MARGIN LEVERAGE [chain]: for example /open NVDA long 100 2x xlayer",
  "/close SYMBOL long|short [PERCENT] [chain]: for example /close NVDA long 50",
  "/add SYMBOL long|short AMOUNT [chain]: add collateral (USDC for a short, shares for a long)",
  "/alerts: which alerts this chat gets",
  "",
  "Open, close and add give you a link: you review the fresh quote in the Levra app and sign with your own wallet. This bot never signs or holds keys.",
].join("\n");

export const NOT_LINKED = "This chat is not linked to a wallet yet. In the Levra app, open Settings, Alerts, and link Telegram; then send the command again.";

export type AlertView = { preClose: boolean; liquidation: boolean; autoDeleverage: boolean; depositArrived: boolean; ltvThresholdWad: string | null };

export type ChatContext = {
  api: LevraApi;
  /** The wallet linked to this chat, or null. */
  wallet: string | null;
  alerts: () => Promise<AlertView | null>;
};

type LiveChain = { chainId: ChainId; slug: string; name: string };

const signedUsd = (raw: bigint) => `${raw < 0n ? "-" : "+"}${usd(raw < 0n ? -raw : raw)}`;
function usd(raw: bigint): string {
  const cents = (raw + 5_000n) / 10_000n;
  return `$${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")}`;
}
const price = (e8: bigint) => usd(e8 / 100n);
const percentOfWad = (wad: bigint) => {
  const bps = (wad * 10_000n) / 10n ** 18n;
  return `${bps / 100n}.${(bps % 100n).toString().padStart(2, "0")}%`;
};
const percentOfBps = (bps: number) => `${bps < 0 ? "-" : "+"}${(Math.abs(bps) / 100).toFixed(2)}%`;
const utc = (unix: number) => new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

/** A decimal amount typed in chat as base units; refuses more decimals than the token has. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const m = /^(\d{1,15})(?:\.(\d+))?$/.exec(text.replace(/,/g, ""));
  if (!m || (m[2] && m[2].length > decimals)) return null;
  const raw = BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0") || "0");
  return raw > 0n ? raw : null;
}

/** "2", "2x" or "1.5x" as the API's leverage x100. */
export function parseLeverage(text: string): number | null {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?x?$/i.exec(text);
  if (!m) return null;
  const e2 = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return e2 > 100 ? e2 : null;
}

function circuitLine(c: RiskCheck | null | undefined): string | null {
  if (c === undefined) return null;
  if (c === null) return "  TapeOut risk circuit: no answer right now.";
  if (!c.matches) return "  TapeOut risk circuit: disagrees with Levra's numbers; trust the numbers above and tell the team.";
  return `  TapeOut risk circuit #${c.circuitId}: ${c.healthy ? "healthy" : "NOT healthy"}, ${c.belowSoftLimit ? "under" : "over"} the soft limit.`;
}

function positionText(p: Position, chain: LiveChain): string {
  const lines = [`${p.symbol} ${p.side} on ${chain.name}`];
  if (BigInt(p.oraclePriceE8) === 0n) {
    lines.push("  No oracle price right now; you can still close it in full.");
  } else {
    const pnl = BigInt(p.unrealizedPnlUsdRaw);
    lines.push(`  Value ${usd(BigInt(p.valueUsdRaw))}, P&L ${signedUsd(pnl)}${p.pnlBps == null ? "" : ` (${percentOfBps(p.pnlBps)})`}`);
    lines.push(`  Debt ratio ${percentOfWad(BigInt(p.ltvWad))}, liquidation at ${percentOfWad(BigInt(p.lltvWad))}, liquidation price about ${price(BigInt(p.liqPriceE8))}`);
    // 04: over the soft limit a position cannot be opened or added to, and it is deleveraged when protection is on.
    if (p.overSoftLimit) lines.push(`  Over the soft limit: you cannot add to it through Levra${p.protection ? ", and protection may reduce it" : ""}.`);
  }
  const circuit = circuitLine(p.circuit);
  if (circuit) lines.push(circuit);
  return lines.join("\n");
}

async function liveChains(api: LevraApi): Promise<LiveChain[]> {
  const { chains } = chainsResponse.parse(await api.get("/v1/chains"));
  return chains.filter((c) => c.live).map((c) => ({ chainId: c.chainId as ChainId, slug: c.slug, name: c.name }));
}

function pickChain(chains: LiveChain[], word: string | undefined): LiveChain | null | undefined {
  if (word === undefined) return undefined;
  const w = word.toLowerCase().replace(/[\s_-]/g, "");
  return chains.find((c) => c.slug === w || c.name.toLowerCase().replace(/\s/g, "") === w || String(c.chainId) === w) ?? null;
}

const chainList = (chains: LiveChain[]) => chains.map((c) => c.slug).join(", ");

/** Positions of the wallet on every live chain; a chain that cannot be read is named, not hidden. */
async function positionsEverywhere(api: LevraApi, wallet: string, chains: LiveChain[]) {
  return Promise.all(
    chains.map(async (chain) => {
      try {
        return { chain, positions: account.parse(await api.get(`/v1/${chain.chainId}/accounts/${wallet}`)).positions, error: null };
      } catch (err) {
        return { chain, positions: [] as Position[], error: err instanceof LevraApiError ? err.code : "UNREADABLE" };
      }
    }),
  );
}

/** Only what finding a market needs, so a change elsewhere in the market shape cannot break `/open`. */
const marketList = z.object({ markets: z.array(marketsResponse.shape.markets.element.pick({ symbol: true, side: true })) });

const prepareAnswer = z.object({
  url: z.string(),
  summary: z.string(),
  // BE-87: on X Layer the API adds the circuits' check of the action.
  circuitCheck: z.object({ risk: riskCheck.nullable(), gap: gapCheck.nullable(), clock: clockCheck.nullable() }).nullable().optional(),
});

function preparedText(answer: unknown): string {
  const p = prepareAnswer.parse(answer);
  const lines = [p.summary, "", `Review and sign in the Levra app (the link works for an hour): ${p.url}`];
  const c = p.circuitCheck;
  if (c) {
    lines.push("", "TapeOut circuits on X Layer (a check, not a guarantee; the contracts check again when you sign):");
    if (c.risk) lines.push(c.risk.matches ? `  Position after this: ${c.risk.healthy ? "healthy" : "NOT healthy"}, ${c.risk.belowSoftLimit ? "under" : "over"} the soft limit.` : "  Position after this: the circuit disagrees with Levra's numbers.");
    if (c.gap) lines.push(c.gap.matches ? `  After a ${(c.gap.moveBps / 100).toFixed(0)}% gap: ${c.gap.healthyAfterGap ? "still healthy" : "would be liquidated"}.` : "  Gap check: the circuit disagrees with Levra's numbers.");
    if (c.clock) lines.push(`  Market session by the Wall Street Clock: ${c.clock.session.toLowerCase().replace("_", " ")}${c.clock.holiday ? " (holiday)" : ""}.`);
  }
  return lines.join("\n");
}

/** The one position a close or add is about; asks for the chain when the same market is open on more than one. */
async function findPosition(api: LevraApi, wallet: string, chains: LiveChain[], symbol: string, side: string, chainWord: string | undefined) {
  const chosen = pickChain(chains, chainWord);
  if (chosen === null) return { error: `Unknown chain "${chainWord}". Live chains: ${chainList(chains)}.` };
  const found = (await positionsEverywhere(api, wallet, chosen ? [chosen] : chains)).flatMap((r) =>
    r.positions.filter((p) => p.symbol.toUpperCase() === symbol && p.side === side).map((p) => ({ chain: r.chain, position: p })),
  );
  if (found.length === 0) return { error: `No ${symbol} ${side} position${chosen ? ` on ${chosen.name}` : ""}. Send /positions to see yours.` };
  if (found.length > 1) return { error: `You have a ${symbol} ${side} on ${found.map((f) => f.chain.slug).join(" and ")}: add the chain at the end.` };
  return found[0]!;
}

/** The reply to one chat message. Never throws: an error becomes a plain message. */
export async function answer(ctx: ChatContext, text: string): Promise<string> {
  try {
    return (await reply(ctx, text)).slice(0, MAX_MESSAGE);
  } catch (err) {
    if (err instanceof LevraApiError) return `Levra could not do that: ${err.message}`;
    return "Something went wrong reading Levra. Try again in a minute.";
  }
}

const sessionName = (s: string) => s.toLowerCase().replace("_", " ");

function sessionLine(chain: LiveChain, s: z.infer<typeof sessionInfo>): string {
  const next = s.closedRegime ? (s.nextOpenAt ? `opens ${utc(s.nextOpenAt)}` : "") : s.nextCloseAt ? `next close ${utc(s.nextCloseAt)}` : "";
  const clock = s.clock && s.clock.matches ? ` (Wall Street Clock circuit: ${sessionName(s.clock.session)})` : "";
  return `${chain.name}: ${sessionName(s.session)}${next ? `, ${next}` : ""}${clock}`;
}

async function reply(ctx: ChatContext, text: string): Promise<string> {
  const [rawCommand, ...args] = text.trim().split(/\s+/);
  const command = (rawCommand ?? "").toLowerCase().replace(/@\w+$/, "");
  if (command === "/start" || command === "/help" || !command.startsWith("/")) return HELP;
  if (!["/positions", "/session", "/open", "/close", "/add", "/alerts"].includes(command)) return `Unknown command ${command}.\n\n${HELP}`;

  const chains = await liveChains(ctx.api);
  if (command === "/session") {
    const lines = await Promise.all(
      chains.map(async (chain) => {
        const s = sessionInfo.safeParse(await ctx.api.get(`/v1/${chain.chainId}/session`).catch(() => null));
        return s.success ? sessionLine(chain, s.data) : `${chain.name}: could not read the session.`;
      }),
    );
    return lines.join("\n");
  }

  const wallet = ctx.wallet;
  if (!wallet) return NOT_LINKED;
  if (command === "/alerts") return alertsText(wallet, await ctx.alerts());
  if (command === "/positions") {
    const results = await positionsEverywhere(ctx.api, wallet, chains);
    const parts = results.flatMap((r) => (r.error ? [`${r.chain.name}: could not read (${r.error}).`] : r.positions.map((p) => positionText(p, r.chain))));
    return parts.length > 0 ? parts.join("\n\n") : "No open positions.";
  }

  const symbol = (args[0] ?? "").toUpperCase();
  const side = (args[1] ?? "").toLowerCase();
  if (!/^[A-Z.]{1,10}$/.test(symbol) || (side !== "long" && side !== "short")) return `Say the stock and the side, for example ${command} NVDA long ...\n\n${HELP}`;
  if (command === "/open") return openAction(ctx.api, wallet, chains, symbol, side, args.slice(2));
  if (command === "/close") return closeAction(ctx.api, wallet, chains, symbol, side, args.slice(2));
  return addAction(ctx.api, wallet, chains, symbol, side, args.slice(2));
}

function alertsText(wallet: string, a: AlertView | null): string {
  if (!a) return NOT_LINKED;
  const on = (b: boolean) => (b ? "on" : "off");
  return [
    `Alerts for ${wallet}:`,
    `  Before the market closes: ${on(a.preClose)}`,
    `  Liquidation and near liquidation: ${on(a.liquidation)}`,
    `  Auto-deleverage: ${on(a.autoDeleverage)}`,
    `  Deposit arrived: ${on(a.depositArrived)}`,
    `  Debt ratio level: ${a.ltvThresholdWad ? percentOfWad(BigInt(a.ltvThresholdWad)) : "off"}`,
    "Change them in the Levra app settings.",
  ].join("\n");
}

async function openAction(api: LevraApi, wallet: string, chains: LiveChain[], symbol: string, side: string, args: string[]): Promise<string> {
  const margin = args[0] ? parseAmount(args[0], USDC_DECIMALS) : null;
  const leverage = args[1] ? parseLeverage(args[1]) : null;
  if (!margin || !leverage) return "Usage: /open SYMBOL long|short MARGIN LEVERAGE [chain], for example /open NVDA long 100 2x xlayer (100 USDC of margin at 2x).";
  const chosen = pickChain(chains, args[2]);
  if (chosen === null) return `Unknown chain "${args[2]}". Live chains: ${chainList(chains)}.`;
  let chain = chosen;
  if (!chain) {
    const listed = await Promise.all(
      chains.map(async (c) => {
        const m = marketList.safeParse(await api.get(`/v1/${c.chainId}/markets`).catch(() => null));
        return m.success && m.data.markets.some((x) => x.symbol.toUpperCase() === symbol && x.side === side) ? c : null;
      }),
    );
    const where = listed.filter((c): c is LiveChain => c !== null);
    if (where.length === 0) return `No ${symbol} ${side} market on Levra.`;
    if (where.length > 1) return `${symbol} ${side} is on ${where.map((c) => c.slug).join(" and ")}: add the chain at the end.`;
    chain = where[0]!;
  }
  const request = { user: wallet, symbol, side, marginRaw: margin.toString(), leverageE2: leverage, slippageBps: CHAT_SLIPPAGE_BPS };
  return preparedText(await api.post(`/v1/${chain.chainId}/agent/prepare`, { kind: "open", request }));
}

async function closeAction(api: LevraApi, wallet: string, chains: LiveChain[], symbol: string, side: string, args: string[]): Promise<string> {
  // The percent is optional, so a first word that names a chain is the chain.
  const percentWord = args[0] !== undefined && pickChain(chains, args[0]) == null ? args[0] : undefined;
  const chainWord = percentWord !== undefined ? args[1] : args[0];
  const bps = percentWord !== undefined ? parseAmount(percentWord.replace(/%$/, ""), 2) : 10_000n;
  if (!bps || bps > 10_000n) return "Usage: /close SYMBOL long|short [PERCENT] [chain], for example /close NVDA long 50 (half). Without a percent it closes all.";
  const found = await findPosition(api, wallet, chains, symbol, side, chainWord);
  if ("error" in found) return found.error;
  // Percent with two decimals is bps; 1 bps of a fraction is 1e14 in WAD.
  const request = { user: wallet, marketId: found.position.marketId, fractionWad: (bps * 10n ** 14n).toString(), slippageBps: CHAT_SLIPPAGE_BPS };
  return preparedText(await api.post(`/v1/${found.chain.chainId}/agent/prepare`, { kind: "close", request }));
}

async function addAction(api: LevraApi, wallet: string, chains: LiveChain[], symbol: string, side: string, args: string[]): Promise<string> {
  const found = await findPosition(api, wallet, chains, symbol, side, args[1]);
  if ("error" in found) return found.error;
  // A short's collateral is USDC; a long's is the stock token itself.
  const decimals = side === "short" ? USDC_DECIMALS : findStock(found.chain.chainId, symbol)?.decimals;
  const amount = args[0] && decimals !== undefined ? parseAmount(args[0], decimals) : null;
  if (!amount) return `Usage: /add SYMBOL long|short AMOUNT [chain]: ${side === "short" ? "USDC" : `${symbol} shares`} to add, for example /add ${symbol} ${side} ${side === "short" ? "50" : "0.5"}.`;
  const request = { user: wallet, marketId: found.position.marketId, action: "add", amountRaw: amount.toString() };
  return preparedText(await api.post(`/v1/${found.chain.chainId}/agent/prepare`, { kind: "collateral", request }));
}
