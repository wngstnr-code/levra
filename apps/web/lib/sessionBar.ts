import type { SessionName } from "@levra/shared/api";
import { addDays, etParts, etToUnix, isTradingDay, regularCloseAt } from "@levra/shared/calendar";

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

/**
 * The US session from the exchange calendar alone, for when the oracle's own session is stale.
 * Overnight trading runs from 20:00 to 04:00 ET on the nights before a trading day.
 */
export function calendarSession(unix: number): SessionName {
  const p = etParts(unix);
  const hours = p.hour + p.minute / 60;
  if (hours < 4) return isTradingDay(p.date) ? "OVERNIGHT" : "CLOSED";
  if (hours >= 20) return isTradingDay(addDays(p.date, 1)) ? "OVERNIGHT" : "CLOSED";
  if (!isTradingDay(p.date)) return "CLOSED";
  if (hours < 9.5) return "PRE_MARKET";
  if (unix < regularCloseAt(p.date)) return "REGULAR";
  return unix < etToUnix(p.date, 20 * 3600) ? "POST_MARKET" : "OVERNIGHT";
}
