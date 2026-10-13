/**
 * US exchange calendar in New York time (BE-30): NYSE holidays and early closes from their rules, daylight saving from
 * the IANA time zone. The Anchored session schedule is not typed in here: it comes in as a `SessionSchedule` measured
 * from the oracle logger data (`observedSessionSchedule` in packages/db), with the regular exchange times as the
 * fallback until a weekend has been observed.
 */

export const NEW_YORK = "America/New_York";

/** A calendar date in New York as `YYYY-MM-DD`. */
export type EtDate = string;

/**
 * When the oracle goes `CLOSED` and comes back, relative to the exchange calendar.
 * - `closeOffsetSeconds`: after the regular close (16:00, or 13:00 on an early close) of the last trading day.
 * - `openOffsetSeconds`: after 00:00 of the next trading day (negative when the market reopens the evening before).
 */
export type SessionSchedule = { closeOffsetSeconds: number; openOffsetSeconds: number; source: "observed" | "regular" };

/** Until a weekend is observed: close at the regular close (an early close is safe, a late one is not), open at 09:30. */
export const REGULAR_SCHEDULE: SessionSchedule = { closeOffsetSeconds: 0, openOffsetSeconds: 9.5 * 3600, source: "regular" };

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Wall clock in New York for a unix time. */
export function etParts(unix: number): { date: EtDate; hour: number; minute: number; second: number; weekday: number } {
  const p = Object.fromEntries(parts.formatToParts(new Date(unix * 1000)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second), weekday: weekdayOf(date) };
}

/** Unix seconds of a wall clock time in New York, with the offset that applies on that day. */
export function etToUnix(date: EtDate, seconds = 0): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d) / 1000 + seconds;
  // New York is UTC-5 or UTC-4. Two corrections settle the offset, also across a daylight saving change.
  let guess = naive + 5 * 3600;
  for (let i = 0; i < 2; i++) {
    const p = etParts(guess);
    const [py, pm, pd] = p.date.split("-").map(Number) as [number, number, number];
    const shown = Date.UTC(py, pm - 1, pd) / 1000 + p.hour * 3600 + p.minute * 60 + p.second;
    guess += naive - shown;
  }
  return guess;
}

export function addDays(date: EtDate, n: number): EtDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 is Sunday. */
export function weekdayOf(date: EtDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const iso = (y: number, m: number, d: number): EtDate => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The n-th given weekday of a month (n = -1 for the last). */
function nthWeekday(y: number, m: number, weekday: number, n: number): EtDate {
  if (n > 0) {
    const first = weekdayOf(iso(y, m, 1));
    return iso(y, m, 1 + ((weekday - first + 7) % 7) + 7 * (n - 1));
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = weekdayOf(iso(y, m, lastDay));
  return iso(y, m, lastDay - ((last - weekday + 7) % 7));
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easter(y: number): EtDate {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

/** A fixed-date holiday moves to Friday when it falls on Saturday and to Monday on Sunday. */
function observed(date: EtDate): EtDate {
  const w = weekdayOf(date);
  return w === 6 ? addDays(date, -1) : w === 0 ? addDays(date, 1) : date;
}

/** NYSE full-day holidays of one year, by rule. */
export function nyseHolidays(year: number): Map<EtDate, string> {
  const out = new Map<EtDate, string>();
  // New Year's Day on a Saturday is not moved to the Friday before (NYSE rule 7.2).
  const newYear = iso(year, 1, 1);
  if (weekdayOf(newYear) !== 6) out.set(observed(newYear), "New Year's Day");
  out.set(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  out.set(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  out.set(addDays(easter(year), -2), "Good Friday");
  out.set(nthWeekday(year, 5, 1, -1), "Memorial Day");
  if (year >= 2022) out.set(observed(iso(year, 6, 19)), "Juneteenth");
  out.set(observed(iso(year, 7, 4)), "Independence Day");
  out.set(nthWeekday(year, 9, 1, 1), "Labor Day");
  out.set(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
  out.set(observed(iso(year, 12, 25)), "Christmas Day");
  return out;
}

export function isHoliday(date: EtDate): boolean {
  return nyseHolidays(Number(date.slice(0, 4))).has(date);
}

export function isTradingDay(date: EtDate): boolean {
  const w = weekdayOf(date);
  return w !== 0 && w !== 6 && !isHoliday(date);
}

/** 13:00 closes: the day before Independence Day, the day after Thanksgiving, Christmas Eve, when they are trading days. */
export function isEarlyClose(date: EtDate): boolean {
  if (!isTradingDay(date)) return false;
  const year = Number(date.slice(0, 4));
  return date === iso(year, 7, 3) || date === addDays(nthWeekday(year, 11, 4, 4), 1) || date === iso(year, 12, 24);
}

/** The exchange's regular close on a trading day, unix seconds. */
export function regularCloseAt(date: EtDate): number {
  return etToUnix(date, (isEarlyClose(date) ? 13 : 16) * 3600);
}

/** A close is the last trading day before a day without trading (a weekend or a holiday). */
function closeOn(date: EtDate, schedule: SessionSchedule): number | null {
  if (!isTradingDay(date) || isTradingDay(addDays(date, 1))) return null;
  return regularCloseAt(date) + schedule.closeOffsetSeconds;
}

/** An open is the first trading day after a day without trading. */
function openOn(date: EtDate, schedule: SessionSchedule): number | null {
  if (!isTradingDay(date) || isTradingDay(addDays(date, -1))) return null;
  return etToUnix(date) + schedule.openOffsetSeconds;
}

const SEARCH_DAYS = 21;

/** The first close strictly after `now`. */
export function nextCloseAfter(now: number, schedule: SessionSchedule = REGULAR_SCHEDULE): number {
  const start = addDays(etParts(now).date, -1);
  for (let i = 0; i < SEARCH_DAYS; i++) {
    const at = closeOn(addDays(start, i), schedule);
    if (at !== null && at > now) return at;
  }
  throw new Error("No close found in three weeks");
}

/** The first reopening strictly after `now`. */
export function nextOpenAfter(now: number, schedule: SessionSchedule = REGULAR_SCHEDULE): number {
  const start = addDays(etParts(now).date, -1);
  for (let i = 0; i < SEARCH_DAYS; i++) {
    const at = openOn(addDays(start, i), schedule);
    if (at !== null && at > now) return at;
  }
  throw new Error("No open found in three weeks");
}

/** The latest close at or before `now`. */
export function lastCloseAtOrBefore(now: number, schedule: SessionSchedule = REGULAR_SCHEDULE): number {
  const today = etParts(now).date;
  for (let i = -1; i < SEARCH_DAYS; i++) {
    const at = closeOn(addDays(today, -i), schedule);
    if (at !== null && at <= now) return at;
  }
  throw new Error("No close found in the last three weeks");
}

/**
 * The Anchored schedule from observed `CLOSED` stretches (weekends and holidays from the oracle logger). The close is
 * the earliest seen, rounded down to the minute, because an early close is safe and a late one is not; the reopening
 * is the latest seen, rounded up. Without any stretch it is the regular schedule.
 */
export function scheduleFromStretches(stretches: { firstClosedAt: number; reopenedAt: number }[]): SessionSchedule {
  const closeOffsets: number[] = [];
  const openOffsets: number[] = [];
  for (const s of stretches) {
    let day = etParts(s.firstClosedAt).date;
    // A close after midnight belongs to the trading day before.
    for (let i = 0; i < 4 && !isTradingDay(day); i++) day = addDays(day, -1);
    if (isTradingDay(day)) closeOffsets.push(s.firstClosedAt - regularCloseAt(day));
    const open = etParts(s.reopenedAt);
    let next = open.hour >= 12 ? addDays(open.date, 1) : open.date;
    for (let i = 0; i < 5 && !isTradingDay(next); i++) next = addDays(next, 1);
    if (isTradingDay(next)) openOffsets.push(s.reopenedAt - etToUnix(next));
  }
  if (closeOffsets.length === 0 || openOffsets.length === 0) return REGULAR_SCHEDULE;
  return {
    closeOffsetSeconds: Math.floor(Math.min(...closeOffsets) / 60) * 60,
    openOffsetSeconds: Math.ceil(Math.max(...openOffsets) / 60) * 60,
    source: "observed",
  };
}

/** True between a close and the reopening that follows it. */
export function isScheduledClosed(now: number, schedule: SessionSchedule = REGULAR_SCHEDULE): boolean {
  const close = lastCloseAtOrBefore(now, schedule);
  return now < nextOpenAfter(close, schedule);
}
