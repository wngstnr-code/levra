import { describe, expect, it } from "vitest";
import { gapScenarios, gapStatsFromBars, gapTable } from "./gaps";
import { WAD, ltvAfterGapWad } from "./math";

const pct = (n: number) => (BigInt(Math.round(n * 100)) * WAD) / 10_000n;

describe("gap scenarios (BE-34)", () => {
  it("long uses the worst drop and equals ltvAfterGapWad from 04", () => {
    const ltv = pct(70);
    const [s] = gapScenarios("long", "QQQ", ltv, pct(77));
    expect(s).toMatchObject({ moveBps: gapTable.QQQ.worstDropBps, liquidated: false });
    expect(s!.ltvWad).toBe(ltvAfterGapWad("long", ltv, (-540n * WAD) / 10_000n).toString());
    // 04: 70% becomes 74.0% after -5.4%.
    expect(Number(BigInt(s!.ltvWad) / 10n ** 14n) / 100).toBeCloseTo(74.0, 1);
  });

  it("short uses the worst rise and equals ltvAfterGapWad from 04", () => {
    const ltv = pct(50);
    const [s] = gapScenarios("short", "HOOD", ltv, pct(62.5));
    expect(s).toMatchObject({ moveBps: gapTable.HOOD.worstRiseBps, liquidated: false });
    expect(s!.ltvWad).toBe(ltvAfterGapWad("short", ltv, (930n * WAD) / 10_000n).toString());
    // 04: 50% becomes 54.7% after +9.3%.
    expect(Number(BigInt(s!.ltvWad) / 10n ** 14n) / 100).toBeCloseTo(54.65, 1);
  });

  it("flags a scenario that reaches the hard limit, and is empty without debt or data", () => {
    expect(gapScenarios("long", "QQQ", pct(73.5), pct(77))[0]!.liquidated).toBe(true);
    expect(gapScenarios("long", "QQQ", 0n, pct(77))).toEqual([]);
    expect(gapScenarios("long", "XYZ", pct(50), pct(77))).toEqual([]);
  });
});

describe("gap table from daily bars (BE-34)", () => {
  it("counts only weekend and holiday gaps and rounds to 10 bps", () => {
    const bars = [
      { date: "2026-01-02", open: 100, close: 100 }, // Friday
      { date: "2026-01-05", open: 94.6, close: 95 }, // Monday: -5.4% from 100
      { date: "2026-01-06", open: 80, close: 96 }, // Tuesday: not a weekend gap, ignored
      { date: "2026-01-09", open: 96, close: 100 }, // Friday after a missing Wednesday/Thursday: counts, 0%
      { date: "2026-01-12", open: 103.9, close: 104 }, // Monday: +3.9%
      { date: "2026-01-13", open: 104, close: 104 },
    ];
    expect(gapStatsFromBars(bars)).toEqual({ events: 3, over2PctShareBps: 6670, worstDropBps: -540, worstRiseBps: 390 });
  });
});
