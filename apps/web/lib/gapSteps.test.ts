import { describe, expect, it } from "vitest";
import { gapSteps, mergeGapScenarios } from "./gapSteps";

const WAD = 10n ** 18n;
const pct = (p: number) => ((BigInt(p) * WAD) / 100n).toString();

describe("gapSteps", () => {
  it("raises a long's LTV on drops and flags liquidation at the hard limit", () => {
    const s = gapSteps("long", pct(50), pct(70), (b) => `${b}`);
    expect(s.map((x) => x.moveBps)).toEqual([-1000, -2000, -3000]);
    expect(BigInt(s[0]!.ltvWad)).toBeGreaterThan(BigInt(pct(50)));
    expect(s.map((x) => x.liquidated)).toEqual([false, false, true]);
  });

  it("uses rises for a short", () => {
    expect(gapSteps("short", pct(40), pct(77), (b) => `${b}`).map((x) => x.moveBps)).toEqual([1000, 2000, 3000]);
  });
});

describe("mergeGapScenarios", () => {
  it("puts the worst gap among the round ones by size", () => {
    const worst = { label: "worst", moveBps: -1780, ltvWad: pct(65), liquidated: false };
    const steps = gapSteps("long", pct(50), pct(77), (b) => `${b}`);
    expect(mergeGapScenarios([worst], steps).map((s) => s.moveBps)).toEqual([-1000, -1780, -2000, -3000]);
  });
});
