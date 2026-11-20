import { BPS, WAD, ltvAfterGapWad, type Side } from "./math";

/**
 * Worst close-to-open gaps over weekends and holidays over five years, from Yahoo Finance (docs/04-risk-rules.md); the
 * period is in `GAP_TABLE_SOURCE`. Basis points; drops are negative. The past is not a guarantee. Rebuilt with
 * `pnpm --filter @levra/keeper report:gaps --write` (BE-34).
 */
export type GapStats = {
  /** Share of events with a gap above 2%, in basis points of the event count. */
  over2PctShareBps: number;
  worstDropBps: number;
  worstRiseBps: number;
};

export const gapTable = {
  BIL: { over2PctShareBps: 0, worstDropBps: -40, worstRiseBps: 10 },
  SPY: { over2PctShareBps: 180, worstDropBps: -400, worstRiseBps: 300 },
  QQQ: { over2PctShareBps: 290, worstDropBps: -540, worstRiseBps: 390 },
  AAPL: { over2PctShareBps: 580, worstDropBps: -940, worstRiseBps: 670 },
  TSLA: { over2PctShareBps: 3140, worstDropBps: -1080, worstRiseBps: 1200 },
  NVDA: { over2PctShareBps: 2340, worstDropBps: -1420, worstRiseBps: 460 },
  HOOD: { over2PctShareBps: 2850, worstDropBps: -1780, worstRiseBps: 930 },
  MSTR: { over2PctShareBps: 5360, worstDropBps: -2740, worstRiseBps: 1480 },
  MSFT: { over2PctShareBps: 400, worstDropBps: -470, worstRiseBps: 320 },
  GOOGL: { over2PctShareBps: 950, worstDropBps: -670, worstRiseBps: 530 },
  META: { over2PctShareBps: 1060, worstDropBps: -750, worstRiseBps: 650 },
  AMZN: { over2PctShareBps: 730, worstDropBps: -820, worstRiseBps: 910 },
  SPCX: { over2PctShareBps: 2610, worstDropBps: -480, worstRiseBps: 670 }, // only 23 events, see gapStandIns
} as const satisfies Record<string, GapStats>;

export const GAP_TABLE_SOURCE = {
  from: "2021-11",
  to: "2026-11",
  eventsPerStock: 274,
  source: "Yahoo Finance daily close and open",
} as const;

/**
 * Stocks whose own history is too short to trust (04): their scenario takes the worse of their own move and the stand-in's.
 * SPCX listed in June 2026, so 04 sizes its limits with NVDA's worst drop.
 */
export const gapStandIns: Record<string, keyof typeof gapTable> = { SPCX: "NVDA" };

/** Same shape as `GapScenario` in api/quotes.ts. */
export type GapScenarioResult = { label: string; moveBps: number; ltvWad: string; liquidated: boolean };

/**
 * The worst weekend or holiday move against the position (04): a drop for a long, a rise for a short, applied with
 * `ltvAfterGapWad`. One helper for quotes and accounts (BE-34). Empty without debt or without gap data for the stock.
 */
export function gapScenarios(side: Side, symbol: string, ltvWad: bigint, lltvWad: bigint): GapScenarioResult[] {
  const table = gapTable as Record<string, GapStats>;
  const gap = table[symbol];
  if (!gap || ltvWad === 0n) return [];
  const against = (g: GapStats) => (side === "long" ? g.worstDropBps : g.worstRiseBps);
  const standIn = Object.hasOwn(gapStandIns, symbol) ? gapStandIns[symbol]! : undefined;
  const own = against(gap);
  const other = standIn ? against(table[standIn]!) : own;
  const useStandIn = side === "long" ? other < own : other > own;
  const move = useStandIn ? other : own;
  const ltvAfter = ltvAfterGapWad(side, ltvWad, (BigInt(move) * WAD) / BPS);
  const base = side === "long" ? "Worst weekend or holiday drop in 5 years" : "Worst weekend or holiday rise in 5 years";
  const label = useStandIn ? `${base} for ${standIn}, used because ${symbol} has a short history` : base;
  return [{ label, moveBps: move, ltvWad: ltvAfter.toString(), liquidated: ltvAfter >= lltvWad }];
}

/** One daily close and the next daily open, in any currency unit, as numbers. */
export type DailyBar = { date: string; open: number; close: number };

/**
 * Rebuilds a `GapStats` row from daily bars, oldest first: a gap is the open after a weekend or holiday against the
 * close before it (calendar days between the two bars above 1). Rounded to 10 bps like the table.
 */
export function gapStatsFromBars(bars: DailyBar[]): GapStats & { events: number } {
  const roundTo10 = (bps: number) => Math.round(bps / 10) * 10 || 0;
  const day = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  let events = 0;
  let over2 = 0;
  let worstDrop = 0;
  let worstRise = 0;
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!;
    const next = bars[i]!;
    if (day(next.date) - day(prev.date) <= 1 || prev.close <= 0) continue;
    const gapBps = ((next.open - prev.close) / prev.close) * 10_000;
    events += 1;
    if (Math.abs(gapBps) > 200) over2 += 1;
    worstDrop = Math.min(worstDrop, gapBps);
    worstRise = Math.max(worstRise, gapBps);
  }
  return {
    events,
    over2PctShareBps: events === 0 ? 0 : roundTo10((over2 / events) * 10_000),
    worstDropBps: roundTo10(worstDrop),
    worstRiseBps: roundTo10(worstRise),
  };
}
