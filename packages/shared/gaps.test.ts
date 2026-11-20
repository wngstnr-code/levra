import { describe, expect, it } from "vitest";
import { gapScenarios, gapStatsFromBars, gapTable } from "./gaps";
import { stocksByChain } from "./markets";
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

  it("has a row for every stock on every chain, found by the symbol in markets.ts (BE-93)", () => {
    for (const [chainId, list] of Object.entries(stocksByChain)) {
      for (const symbol of Object.keys(list)) {
        expect(gapScenarios("long", symbol, pct(50), pct(77)), `${symbol} on ${chainId}`).toHaveLength(1);
      }
    }
  });

  it("matches the closed checks of the Base and X Layer limits in 04", () => {
    const after = (side: "long" | "short", symbol: string, soft: number) => Number(BigInt(gapScenarios(side, symbol, pct(soft), pct(77))[0]!.ltvWad) / 10n ** 14n) / 100;
    // 04 "Base limits": soft closed, then the worst gap against the position.
    expect(after("long", "MSFT", 70)).toBeCloseTo(73.45, 1);
    expect(after("long", "GOOGL", 70)).toBeCloseTo(75.0, 1);
    expect(after("long", "META", 68)).toBeCloseTo(73.5, 1);
    expect(after("short", "AMZN", 68)).toBeCloseTo(74.2, 1);
    expect(after("long", "AAPL", 66)).toBeCloseTo(72.8, 1);
    expect(after("long", "TSLA", 52)).toBeCloseTo(58.3, 1);
    expect(after("long", "NVDA", 50)).toBeCloseTo(58.3, 1);
    // 04 "X Layer limits".
    expect(after("long", "SPY", 70)).toBeCloseTo(72.9, 1);
    expect(after("short", "QQQ", 70)).toBeCloseTo(72.7, 1);
  });

  it("uses NVDA's worst drop for SPCX, whose own history is too short (04)", () => {
    const [long] = gapScenarios("long", "SPCX", pct(45), pct(62.5));
    expect(long).toMatchObject({ moveBps: gapTable.NVDA.worstDropBps, liquidated: false });
    expect(long!.label).toContain("NVDA");
    // 04: 45% becomes 52.4% with NVDA's -14.2%.
    expect(Number(BigInt(long!.ltvWad) / 10n ** 14n) / 100).toBeCloseTo(52.45, 1);
    // NVDA's +4.6% is milder than SPCX's own +6.7%, so the short keeps its own: 45% becomes 48.0%.
    const [short] = gapScenarios("short", "SPCX", pct(45), pct(62.5));
    expect(short).toMatchObject({ moveBps: gapTable.SPCX.worstRiseBps });
    expect(short!.label).not.toContain("NVDA");
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
