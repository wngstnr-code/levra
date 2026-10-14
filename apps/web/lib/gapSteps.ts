import { ltvAfterGapWad, type Side } from "@levra/shared/math";

const BPS_TO_WAD = 10n ** 14n;
/** Round gaps shown next to the worst one in five years, as in the Figma design. Basis points, against the position. */
export const GAP_STEPS_BPS = [1000, 2000, 3000];

export type GapScenario = { label: string; moveBps: number; ltvWad: string; liquidated: boolean };

/** LTV after each round gap, with the shared formula so it matches the contracts. A long fears drops, a short rises. */
export function gapSteps(side: Side, ltvWad: string, lltvWad: string, label: (moveBps: number) => string): GapScenario[] {
  return GAP_STEPS_BPS.map((step) => {
    const moveBps = side === "long" ? -step : step;
    const after = ltvAfterGapWad(side, BigInt(ltvWad), BigInt(moveBps) * BPS_TO_WAD);
    return { label: label(moveBps), moveBps, ltvWad: after.toString(), liquidated: after >= BigInt(lltvWad) };
  });
}

/** The service's worst historical gap first, then the round gaps it does not already cover, smallest move first. */
export function mergeGapScenarios(fromQuote: GapScenario[], steps: GapScenario[]): GapScenario[] {
  const worst = Math.max(0, ...fromQuote.map((s) => Math.abs(s.moveBps)));
  return [...fromQuote, ...steps.filter((s) => Math.abs(s.moveBps) !== worst)].sort((a, b) => Math.abs(a.moveBps) - Math.abs(b.moveBps));
}
