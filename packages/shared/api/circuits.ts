import { z } from "zod";
import { address, sessionName, signedBps } from "./primitives";

/**
 * Answers from Levra's TapeOut circuits on X Layer (BE-83, BE-86, D-66, D-113), next to the API's own numbers. Soft layer
 * only: no contract and no hard limit reads a circuit. `matches` is false when the circuit and the API's own rules
 * (math.ts, calendar.ts) disagree; the app then shows the difference instead of a "checked" mark.
 */
const circuitRef = z.object({
  /** The processor's circuit collection on X Layer; `eval(circuitId, input)` gives the same answer to anyone. */
  processor: address,
  circuitId: z.number().int().positive(),
});

/** The risk circuit for a position: at or under the hard limit, and at or under the soft limit that applies now. */
export const riskCheck = circuitRef.extend({
  healthy: z.boolean(),
  belowSoftLimit: z.boolean(),
  matches: z.boolean(),
});
export type RiskCheck = z.infer<typeof riskCheck>;

/** The risk circuit after the worst weekend or holiday gap of `gapScenarios[0]`. */
export const gapCheck = circuitRef.extend({
  moveBps: signedBps,
  healthyAfterGap: z.boolean(),
  matches: z.boolean(),
});
export type GapCheck = z.infer<typeof gapCheck>;

/** The Wall Street Clock circuit at the time of the answer. */
export const clockCheck = circuitRef.extend({
  session: sessionName,
  holiday: z.boolean(),
  weekend: z.boolean(),
  earlyClose: z.boolean(),
  matches: z.boolean(),
});
export type ClockCheck = z.infer<typeof clockCheck>;
