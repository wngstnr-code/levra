import { KEEPER_HEARTBEAT_LIMIT_S, type KeeperName } from "@levra/shared/api";
import { BPS, WAD, liquidationIncentiveFactorWad, utilizationWad } from "@levra/shared/math";

/**
 * The team monitor's checks (BE-50), one per row of "What we monitor" in 08, as pure functions of one snapshot. Limits
 * are initial proposals unless they come from data or from the chain.
 */
export const LIMITS = {
  /** MON a keeper wallet should keep for gas. About 70 transactions at the deployment's measured cost. */
  minKeeperMonWei: 5n * 10n ** 18n,
  /** Share of a market's supply that is borrowed before lenders may have trouble withdrawing. */
  utilizationWad: (95n * WAD) / 100n,
  /** About two minutes of Monad blocks. */
  indexerLagBlocks: 300n,
  /** A slow answer from the public API. */
  apiSlowMs: 3_000,
  /** How long a condition must last before the team is told (08: "more than a few minutes"). */
  unhealthyForSeconds: 300,
  /** Covers the oracle's Friday 20:00 to 20:15 ET flips between POST_MARKET and CLOSED, which are normal (BE-03). */
  sessionForSeconds: 1_800,
  apiForSeconds: 120,
  /** A depth run older than this is not judged. The depth keeper measures daily. */
  depthMaxAgeSeconds: 2 * 86_400,
  /** Bad debt and risk-value events older than this are not reported on a first start. */
  eventLookbackSeconds: 86_400,
} as const;

/** A condition to watch: `active` now, alert after `forSeconds`, resolve when it ends. */
export type Condition = { kind: "condition"; key: string; active: boolean; forSeconds: number; message: string };
/** A value to watch: alert on every change after the first one seen. */
export type Value = { kind: "value"; key: string; value: string; describe: (before: string, after: string) => string };
/** Something that happened once: alert once per key. */
export type Event = { kind: "event"; key: string; message: string };
export type Finding = Condition | Value | Event;

export type OracleLimit = { limitSeconds: number; learning: boolean };

export type Snapshot = {
  now: number;
  /** Whether the exchange calendar says the market is closed now, and whether that schedule is observed or the fallback. */
  scheduleClosed: boolean;
  scheduleObserved: boolean;
  stocks: { symbol: string; session: string; feedUpdatedAt: number; priceE8: bigint; dexMidE8: bigint | null; maxDeviationBps: number; limit: OracleLimit }[];
  markets: {
    marketId: string;
    label: string;
    side: "long" | "short";
    lltvWad: bigint;
    maxOracleAge: number;
    maxPositionUsdRaw: bigint;
    totalSupplyRaw: bigint;
    totalBorrowRaw: bigint;
    /** Rows of the latest depth run for this stock: for a long the sells matter, for a short the buys. */
    depth: { direction: "buy" | "sell"; sizeUsdRaw: bigint; deviationBps: number; measuredAt: number }[];
  }[];
  nextCloseAt: number;
  heartbeats: { name: KeeperName; lastBeatAt: number; lastError: string | null }[];
  wallets: { role: string; address: string; balanceWei: bigint }[];
  unhealthy: { borrower: string; label: string }[];
  badDebt: { txHash: string; logIndex: number; label: string; borrower: string; badDebtAssets: bigint; at: number }[];
  indexer: { cursor: string; lastBlock: bigint }[];
  head: bigint;
  /** Null when no API address is configured. */
  api: { ok: boolean; ms: number; detail: string } | null;
};

const pct = (wad: bigint) => `${(Number((wad * 10_000n) / WAD) / 100).toFixed(2)}%`;
const mon = (wei: bigint) => `${(Number(wei / 10n ** 15n) / 1000).toFixed(3)} MON`;
const minutes = (s: number) => `${Math.round(s / 60)} min`;

export function evaluate(s: Snapshot, self: KeeperName = "monitor"): Finding[] {
  const out: Finding[] = [];
  const open = !s.scheduleClosed;

  for (const st of s.stocks) {
    const age = s.now - st.feedUpdatedAt;
    out.push({
      kind: "condition",
      key: `oracle-age:${st.symbol}`,
      active: open && st.session !== "CLOSED" && age > st.limit.limitSeconds,
      forSeconds: 0,
      message: `${st.symbol} oracle price is ${minutes(age)} old in ${st.session}, above the ${minutes(st.limit.limitSeconds)} limit${st.limit.learning ? " (strict default while the session has few samples)" : ""}.`,
    });
    // Until a weekend is observed the calendar closes at the regular close, hours before the oracle, so this check waits for data.
    const mismatch = s.scheduleObserved && (st.session === "CLOSED") !== s.scheduleClosed;
    out.push({
      kind: "condition",
      key: `session:${st.symbol}`,
      active: mismatch,
      forSeconds: LIMITS.sessionForSeconds,
      message: `${st.symbol} oracle session is ${st.session} while the calendar says the market is ${s.scheduleClosed ? "closed" : "open"}.`,
    });
    if (st.dexMidE8 !== null && st.priceE8 > 0n) {
      const diff = st.dexMidE8 > st.priceE8 ? st.dexMidE8 - st.priceE8 : st.priceE8 - st.dexMidE8;
      const bps = Number((diff * BPS) / st.priceE8);
      out.push({
        kind: "condition",
        key: `dex-deviation:${st.symbol}`,
        active: open && bps > st.maxDeviationBps,
        forSeconds: 0,
        message: `${st.symbol} DEX mid is ${bps} bps from the oracle, above maxDeviationBps ${st.maxDeviationBps}.`,
      });
    }
  }

  for (const h of s.heartbeats) {
    if (h.name === self) continue;
    const age = s.now - h.lastBeatAt;
    const late = age > KEEPER_HEARTBEAT_LIMIT_S[h.name];
    out.push({
      kind: "condition",
      key: `heartbeat:${h.name}`,
      active: late || h.lastError !== null,
      forSeconds: 0,
      message: late ? `Keeper ${h.name} has not beaten for ${minutes(age)}.` : `Keeper ${h.name} reports an error: ${h.lastError}`,
    });
  }

  for (const m of s.markets) {
    out.push({ kind: "value", key: `max-oracle-age:${m.marketId}`, value: String(m.maxOracleAge), describe: (a, b) => `maxOracleAge of ${m.label} changed from ${a} to ${b} seconds.` });
    const util = utilizationWad(m.totalBorrowRaw, m.totalSupplyRaw);
    out.push({
      kind: "condition",
      key: `utilization:${m.marketId}`,
      active: util >= LIMITS.utilizationWad,
      forSeconds: 0,
      message: `${m.label} is ${pct(util)} borrowed. Lenders may not be able to withdraw.`,
    });

    // 04 position caps: selling (or buying back) a whole capped position must lose less to the oracle than the bonus.
    const direction = m.side === "long" ? "sell" : "buy";
    const rows = m.depth.filter((d) => d.direction === direction && s.now - d.measuredAt <= LIMITS.depthMaxAgeSeconds).sort((a, b) => (a.sizeUsdRaw < b.sizeUsdRaw ? -1 : 1));
    const row = rows.find((d) => d.sizeUsdRaw >= m.maxPositionUsdRaw);
    if (row) {
      const loss = m.side === "long" ? -row.deviationBps : row.deviationBps;
      const bonusBps = Number(((liquidationIncentiveFactorWad(m.lltvWad) - WAD) * BPS) / WAD);
      out.push({
        kind: "condition",
        key: `depth:${m.marketId}`,
        active: loss >= bonusBps,
        forSeconds: 0,
        message: `${m.label}: a ${direction} of $${Number(row.sizeUsdRaw / 10n ** 6n)} trades ${loss} bps from the oracle, not under the ${bonusBps} bps liquidation bonus. The position cap no longer fits the depth.`,
      });
    }
  }
  out.push({ kind: "value", key: "next-close-at", value: String(s.nextCloseAt), describe: (a, b) => `nextCloseAt changed from ${new Date(Number(a) * 1000).toISOString()} to ${new Date(Number(b) * 1000).toISOString()}.` });

  for (const w of s.wallets) {
    out.push({
      kind: "condition",
      key: `balance:${w.role}`,
      active: w.balanceWei < LIMITS.minKeeperMonWei,
      forSeconds: 0,
      message: `${w.role} wallet ${w.address} has ${mon(w.balanceWei)}, below ${mon(LIMITS.minKeeperMonWei)}.`,
    });
  }

  for (const u of s.unhealthy) {
    out.push({ kind: "condition", key: `unhealthy:${u.label}:${u.borrower.toLowerCase()}`, active: true, forSeconds: LIMITS.unhealthyForSeconds, message: `${u.label} position of ${u.borrower} is past the hard limit and not liquidated.` });
  }

  for (const b of s.badDebt) {
    if (s.now - b.at > LIMITS.eventLookbackSeconds) continue;
    out.push({ kind: "event", key: `bad-debt:${b.txHash}:${b.logIndex}`, message: `Bad debt of ${b.badDebtAssets} base units in ${b.label} from ${b.borrower}. Transaction ${b.txHash}.` });
  }

  for (const c of s.indexer) {
    const lag = s.head > c.lastBlock ? s.head - c.lastBlock : 0n;
    out.push({ kind: "condition", key: `indexer:${c.cursor}`, active: lag > LIMITS.indexerLagBlocks, forSeconds: 0, message: `Indexer ${c.cursor} is ${lag} blocks behind the chain.` });
  }

  if (s.api) {
    out.push({
      kind: "condition",
      key: "api",
      active: !s.api.ok || s.api.ms > LIMITS.apiSlowMs,
      forSeconds: LIMITS.apiForSeconds,
      message: s.api.ok ? `The API answered in ${s.api.ms} ms, above ${LIMITS.apiSlowMs} ms.` : `The API failed: ${s.api.detail}`,
    });
  }
  return out;
}

/**
 * The "price too old" limit per stock and session from the BE-03 data: the 99th percentile of the source quote age plus
 * one heartbeat, as in the `maxOracleAge` rule (04). With too few samples in that session, the strict default.
 */
export function oracleLimit(stats: { p99: number; n: number } | undefined, strictDefaultSeconds: number, rule: { minSamples: number; heartbeatSeconds: number; floorSeconds: number }): OracleLimit {
  if (!stats || stats.n < rule.minSamples) return { limitSeconds: strictDefaultSeconds, learning: true };
  return { limitSeconds: Math.ceil(Math.max(rule.floorSeconds, stats.p99 + rule.heartbeatSeconds) / 60) * 60, learning: false };
}
