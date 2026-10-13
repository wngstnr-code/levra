/** The automatic `maxOracleAge` rule in 04. Initial proposal. All values in seconds. */
export const maxAgeRule = {
  minSpanSeconds: 7 * 24 * 3600,
  minFullWeekends: 1,
  minSamples: 500,
  heartbeatSeconds: 600,
  floorSeconds: 1500,
} as const;

export type AgeStats = {
  /** 99th percentile of the source quote age, sampled outside `CLOSED`. */
  p99AgeSeconds: number;
  samples: number;
  spanSeconds: number;
  fullWeekends: number;
};

export type MaxAgeProposal = { value: number; reason: null } | { value: null; reason: string };

export function proposeMaxOracleAge(stats: AgeStats): MaxAgeProposal {
  if (stats.spanSeconds < maxAgeRule.minSpanSeconds) return { value: null, reason: "less than 7 days of data" };
  if (stats.fullWeekends < maxAgeRule.minFullWeekends) return { value: null, reason: "no full weekend observed" };
  if (stats.samples < maxAgeRule.minSamples) return { value: null, reason: `fewer than ${maxAgeRule.minSamples} samples` };
  const raw = Math.max(maxAgeRule.floorSeconds, stats.p99AgeSeconds + maxAgeRule.heartbeatSeconds);
  return { value: Math.ceil(raw / 60) * 60, reason: null };
}
