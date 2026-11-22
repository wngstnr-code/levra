import { etParts } from "@levra/shared/calendar";

/** The US trading day in Eastern time, as shown on the session bar. Hours are ET, from 04:00 to 04:00 the next day. */
export const sessionSegments = [
  { key: "PRE_MARKET", from: 4, to: 9.5 },
  { key: "REGULAR", from: 9.5, to: 16 },
  { key: "POST_MARKET", from: 16, to: 20 },
  { key: "OVERNIGHT", from: 20, to: 28 },
] as const;

const DAY_START = 4;
const DAY_HOURS = 24;

/** Where "now" sits on the bar, from 0 to 1. */
export function dayProgress(unix: number): number {
  const p = etParts(unix);
  const hours = p.hour + p.minute / 60 + p.second / 3600;
  const fromStart = (hours - DAY_START + DAY_HOURS) % DAY_HOURS;
  return fromStart / DAY_HOURS;
}

export function segmentShare(seg: { from: number; to: number }): number {
  return (seg.to - seg.from) / DAY_HOURS;
}
