import { BPS, WAD, ltvAfterGapWad, type Side } from "./math";

/**
 * Worst close-to-open gaps over weekends and holidays, October 2021 to October 2026, 261 events per stock,
 * from Yahoo Finance (docs/04-risk-rules.md). Basis points; drops are negative. The past is not a guarantee.
 */
export type GapStats = {
  /** Share of events with a gap above 2%, in basis points of the event count. */
  over2PctShareBps: number;
  worstDropBps: number;
  worstRiseBps: number;
};

export const gapTable = {
  BIL: { over2PctShareBps: 0, worstDropBps: -40, worstRiseBps: 10 },
  SPY: { over2PctShareBps: 190, worstDropBps: -400, worstRiseBps: 300 },
  QQQ: { over2PctShareBps: 310, worstDropBps: -540, worstRiseBps: 390 },
  AAPL: { over2PctShareBps: 610, worstDropBps: -940, worstRiseBps: 670 },
  TSLA: { over2PctShareBps: 3370, worstDropBps: -1080, worstRiseBps: 1200 },
  NVDA: { over2PctShareBps: 2340, worstDropBps: -1420, worstRiseBps: 460 },
  HOOD: { over2PctShareBps: 2760, worstDropBps: -1780, worstRiseBps: 930 },
  MSTR: { over2PctShareBps: 5290, worstDropBps: -2740, worstRiseBps: 1480 },
} as const satisfies Record<string, GapStats>;

export const GAP_TABLE_SOURCE = {
  from: "2021-10",
  to: "2026-10",
  eventsPerStock: 261,
  source: "Yahoo Finance daily close and open",
} as const;

/** Same shape as `GapScenario` in api/quotes.ts. */
export type GapScenarioResult = { label: string; moveBps: number; ltvWad: string; liquidated: boolean };

/**
 * The worst weekend or holiday move against the position (04): a drop for a long, a rise for a short, applied with
 * `ltvAfterGapWad`. One helper for quotes and accounts (BE-34). Empty without debt or without gap data for the stock.
 */
export function gapScenarios(side: Side, symbol: string, ltvWad: bigint, lltvWad: bigint): GapScenarioResult[] {
  const gap = (gapTable as Record<string, GapStats>)[symbol];
  if (!gap || ltvWad === 0n) return [];
  const move = side === "long" ? gap.worstDropBps : gap.worstRiseBps;
  const ltvAfter = ltvAfterGapWad(side, ltvWad, (BigInt(move) * WAD) / BPS);
  const label = side === "long" ? "Worst weekend or holiday drop in 5 years" : "Worst weekend or holiday rise in 5 years";
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
