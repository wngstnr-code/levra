import { addDays, etParts, weekdayOf, type EtDate, type SessionSchedule } from "@levra/shared/calendar";
import { clockInput, evalCircuit, readClockOutput, type ClockReading } from "@levra/tapeout";
import type { Address, PublicClient } from "viem";

/** The Wall Street Clock circuit (BE-86) read at one unix time. */
export type ClockSource = (unix: number) => Promise<ClockReading>;

export const onchainClock =
  (client: PublicClient, circuits: Address, id: bigint): ClockSource =>
  async (unix) =>
    readClockOutput(await evalCircuit(client, circuits, id, clockInput(unix)));

/** The circuit never changes, so an answer is kept. A failed read is not, so it is asked again on the next run. */
export function memoClock(read: ClockSource, max = 1_000): ClockSource {
  const seen = new Map<number, Promise<ClockReading>>();
  return (unix) => {
    let hit = seen.get(unix);
    if (!hit) {
      if (seen.size >= max) seen.clear();
      hit = read(unix);
      hit.catch(() => seen.delete(unix));
      seen.set(unix, hit);
    }
    return hit;
  };
}

const SEARCH_DAYS = 21;
/** 16:00 UTC is 11:00 or 12:00 in New York: inside regular hours on every trading day, early closes included. */
const PROBE_SECONDS = 16 * 3_600;
const REGULAR_CLOSE_SECONDS = 16 * 3_600;
const EARLY_CLOSE_SECONDS = 13 * 3_600;
/** New York is 5 hours behind UTC in winter and 4 in summer. */
const UTC_OFFSETS = [5 * 3_600, 4 * 3_600];

const utcDay = (date: EtDate) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 1_000;
};

/**
 * The first close after `now` with every calendar fact taken from the circuit: which days trade, early closes and daylight
 * saving. Same rule as `nextCloseAfter` in calendar.ts: a close is the last trading day before a day without trading, at
 * Saturday 00:00 UTC after a full Friday on a `weeklyUtc` schedule. Null when the circuit answers UNKNOWN (outside its
 * years) or its answers do not form a close.
 */
export async function closeFromClock(now: number, schedule: SessionSchedule, clock: ClockSource): Promise<number | null> {
  const start = addDays(etParts(now).date, -1);
  for (let i = 0; i < SEARCH_DAYS; i++) {
    const date = addDays(start, i);
    const [today, tomorrow] = await Promise.all([clock(utcDay(date) + PROBE_SECONDS), clock(utcDay(addDays(date, 1)) + PROBE_SECONDS)]);
    if (today.session === "UNKNOWN" || tomorrow.session === "UNKNOWN") return null;
    if (today.session !== "REGULAR" || tomorrow.session === "REGULAR") continue;
    const at = await closeOn(date, today.earlyClose, schedule, clock);
    if (at === null) return null;
    if (at > now) return at;
  }
  return null;
}

async function closeOn(date: EtDate, early: boolean, schedule: SessionSchedule, clock: ClockSource): Promise<number | null> {
  if (schedule.weeklyUtc && weekdayOf(date) === 5 && !early) return utcDay(addDays(date, 1));
  const local = utcDay(date) + (early ? EARLY_CLOSE_SECONDS : REGULAR_CLOSE_SECONDS);
  for (const offset of UTC_OFFSETS) {
    const at = local + offset;
    const [before, after] = await Promise.all([clock(at - 60), clock(at)]);
    if (before.session === "REGULAR" && after.session !== "REGULAR") return at + schedule.closeOffsetSeconds;
  }
  return null;
}

export type ClockCheck =
  | { status: "agrees"; close: number }
  | { status: "differs"; close: number; circuit: number | null }
  | { status: "unreadable"; close: number; error: string };

/** Initial proposal: a slow RPC endpoint must not hold up the post, which runs after the check. */
export const CHECK_TIMEOUT_MS = 30_000;

/** Compares the calendar's close with the circuit's. */
export async function checkClose(now: number, schedule: SessionSchedule, close: number, clock: ClockSource, timeoutMs = CHECK_TIMEOUT_MS): Promise<ClockCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs / 1_000} s`)), timeoutMs);
  });
  try {
    const circuit = await Promise.race([closeFromClock(now, schedule, clock), timeout]);
    return circuit === close ? { status: "agrees", close } : { status: "differs", close, circuit };
  } catch (err) {
    return { status: "unreadable", close, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Initial proposal: three runs of the poster (30 minutes) before an unreadable circuit is reported. */
export const UNREADABLE_RUNS = 3;

const iso = (unix: number) => new Date(unix * 1_000).toISOString();

/**
 * What to tell the team after a check, once per new problem and once when it ends. A circuit that cannot be read is told
 * after `UNREADABLE_RUNS` runs in a row, so one failed RPC call is not a page.
 */
export function clockAlerts(chainName: string) {
  let told: string | null = null;
  let unreadable = 0;
  return (c: ClockCheck): string | null => {
    unreadable = c.status === "unreadable" ? unreadable + 1 : 0;
    let key: string | null = null;
    let text = "";
    if (c.status === "differs") {
      key = `differs:${c.close}:${c.circuit}`;
      const circuit = c.circuit === null ? "finds no close (outside its years, or answers that do not form a close)" : `gives ${iso(c.circuit)}`;
      text = `${chainName} calendar poster: the Wall Street Clock circuit ${circuit}, calendar.ts gives ${iso(c.close)}. Posting the calendar.ts close.`;
    } else if (c.status === "unreadable" && unreadable >= UNREADABLE_RUNS) {
      key = "unreadable";
      text = `${chainName} calendar poster: the Wall Street Clock circuit could not be read for ${unreadable} runs (${c.error}). Posting the calendar.ts close.`;
    } else if (c.status === "unreadable") {
      return null;
    }
    if (key === told) return null;
    const ended = told !== null && key === null;
    told = key;
    if (ended) return `${chainName} calendar poster: the Wall Street Clock circuit agrees with calendar.ts again (${iso(c.close)}).`;
    return key === null ? null : text;
  };
}
