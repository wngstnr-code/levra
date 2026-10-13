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
