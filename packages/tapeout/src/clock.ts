import { addDays, etParts, isEarlyClose, isHoliday, isTradingDay, nyseHolidays, type EtDate } from "@levra/shared/calendar";
import type { Hex } from "viem";
import { Logic, type Word } from "./gates";
import { CircuitBuilder, packBits, toBits, unpackBits } from "./netlist";

/**
 * Wall Street Clock (BE-86, D-66): the US market session for a moment, as a TapeOut circuit any app can `eval`. Soft
 * layer only: no contract and no hard limit reads it. Holidays, early closes and daylight saving come from `calendar.ts`
 * for a fixed span of years and are built into the circuit; outside that span it answers UNKNOWN.
 *
 * Input: the UTC day since 1970-01-01 (16 bits) then the UTC minute of that day (11 bits), LSB first, which any caller
 * gets from a unix time without a calendar. Output: the session (3 bits, the order of `Session` in 03), then holiday,
 * weekend and early close flags of the New York date.
 *
 * Sessions in New York time (05): overnight 20:00 to 04:00 when the next day trades, pre-market 04:00 to 09:30, regular
 * 09:30 to 16:00 (13:00 on an early close), after-hours to 20:00 (17:00 on an early close), closed otherwise.
 */
export const CLOCK_SESSIONS = ["UNKNOWN", "PRE_MARKET", "REGULAR", "POST_MARKET", "OVERNIGHT", "CLOSED"] as const;
export type ClockSession = (typeof CLOCK_SESSIONS)[number];
export type ClockReading = { session: ClockSession; holiday: boolean; weekend: boolean; earlyClose: boolean };

export const CLOCK_DAY_BITS = 16;
export const CLOCK_MINUTE_BITS = 11;
const MINUTE_KEY = 2048n;
const EDT_MINUTES = 240n;
const EST_MINUTES = 300n;
const MIN = { preOpen: 240n, open: 570n, earlyClose: 780n, close: 960n, earlyPostEnd: 1020n, postEnd: 1200n } as const;

const dayOf = (date: EtDate) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const offsetMinutes = (unix: number) => {
  const p = etParts(unix);
  return Math.round((dayOf(p.date) * 86_400 + p.hour * 3600 + p.minute * 60 + p.second - unix) / 60);
};
const keyOf = (unix: number) => BigInt(Math.floor(unix / 86_400)) * MINUTE_KEY + BigInt(Math.floor((unix % 86_400) / 60));

/** The calendar facts the circuit holds, all derived from `calendar.ts` and the IANA time zone. */
export function clockTables(fromYear: number, toYear: number) {
  const first = dayOf(`${fromYear}-01-01`);
  const last = dayOf(`${toYear}-12-31`);
  const holidays: number[] = [];
  for (let y = fromYear; y <= toYear + 1; y++) for (const date of nyseHolidays(y).keys()) holidays.push(dayOf(date));
  const earlyCloses: number[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    for (let d = dayOf(`${y}-01-01`); d <= dayOf(`${y}-12-31`); d++) {
      const date = new Date(d * 86_400_000).toISOString().slice(0, 10);
      if (isEarlyClose(date)) earlyCloses.push(d);
    }
  }
  // Daylight saving as [start, end) keys in UTC (day * 2048 + minute), found where New York's offset changes.
  const dst: [bigint, bigint][] = [];
  let start: bigint | null = null;
  for (let d = first - 1; d <= last + 1; d++) {
    const noon = d * 86_400 + 12 * 3600;
    if (offsetMinutes(noon) === offsetMinutes(noon - 86_400)) continue;
    let lo = noon - 86_400;
    let hi = noon;
    while (hi - lo > 60) {
      const mid = lo + Math.floor((hi - lo) / 120) * 60;
      if (offsetMinutes(mid) === offsetMinutes(lo)) lo = mid;
      else hi = mid;
    }
    if (offsetMinutes(hi) === -240) start = keyOf(hi);
    else if (start !== null) {
      dst.push([start, keyOf(hi)]);
      start = null;
    }
  }
  return {
    first,
    last,
    holidays: holidays.filter((d) => d >= first && d <= last),
    holidaysNext: holidays.filter((d) => d > first && d <= last + 1).map((d) => d - 1),
    earlyCloses,
    dst,
  };
}

/** `x mod 7` as 3 bits, where 7 also means 0: 8 is 1 mod 7, so the octal digits are summed until 3 bits remain. */
function mod7(g: Logic, x: Word): Word {
  let w = x;
  let max = 2 ** x.length - 1;
  while (w.length > 3) {
    const chunks: Word[] = [];
    for (let i = 0; i < w.length; i += 3) chunks.push(w.slice(i, i + 3));
    let sumMax = 0;
    for (let v = 0; v <= max; v++) {
      let s = 0;
      for (let r = v; r > 0; r >>= 3) s += r & 7;
      sumMax = Math.max(sumMax, s);
    }
    const width = Math.max(3, Math.ceil(Math.log2(sumMax + 1)));
    let acc = chunks[0]!;
    for (const ch of chunks.slice(1)) acc = g.add(acc, ch, width).sum;
    w = acc.slice(0, width);
    max = sumMax;
  }
  return w;
}

/** The Wall Street Clock for New York dates in `fromYear` to `toYear`. */
export function wallStreetClock(fromYear: number, toYear: number) {
  const t = clockTables(fromYear, toYear);
  const c = new CircuitBuilder(CLOCK_DAY_BITS + CLOCK_MINUTE_BITS);
  const g = new Logic(c);
  const day = Array.from({ length: CLOCK_DAY_BITS }, (_, i) => c.input(i));
  const minute = Array.from({ length: CLOCK_MINUTE_BITS }, (_, i) => c.input(CLOCK_DAY_BITS + i));

  const key = [...minute, ...day];
  const dst = g.any(t.dst.map(([s, e]) => g.and(g.geConst(key, s), g.ltConst(key, e))));

  // New York minute and date: subtract 4 or 5 hours, borrowing a day before 04:00 or 05:00 UTC.
  const m12 = [...minute, g.constant(0n, 1)[0]!];
  const edt = g.add(m12, g.constant(4096n - EDT_MINUTES, 12), 12);
  const est = g.add(m12, g.constant(4096n - EST_MINUTES, 12), 12);
  const diff = g.muxWord(dst, edt.sum, est.sum);
  const borrow = g.not(g.mux(dst, edt.carry, est.carry));
  const local = g.muxWord(borrow, g.add(diff, g.constant(1440n, 12), 12).sum, diff).slice(0, CLOCK_MINUTE_BITS);
  const etDay = g.add(day, Array<number>(CLOCK_DAY_BITS).fill(borrow), CLOCK_DAY_BITS).sum;

  const inRange = g.and(g.geConst(etDay, BigInt(t.first)), g.ltConst(etDay, BigInt(t.last + 1)));
  // 1970-01-01 was a Thursday, so the weekday is (day + 4) mod 7: Friday at 1, Saturday at 2, Sunday at 3.
  const r = mod7(g, etDay);
  const at = (v: bigint) => g.eqConst(r, v);
  const weekend = g.or(at(2n), at(3n));
  const nextWeekend = g.or(at(1n), at(2n));
  const listed = (days: number[]) => g.any(days.map((d) => g.eqConst(etDay, BigInt(d))));
  const holiday = listed(t.holidays);
  const holidayNext = listed(t.holidaysNext);
  const early = listed(t.earlyCloses);

  const trading = g.all([inRange, g.not(weekend), g.not(holiday)]);
  const tradingNext = g.and(g.not(nextWeekend), g.not(holidayNext));
  const before = (v: bigint) => g.ltConst(local, v);
  const ltPre = before(MIN.preOpen);
  const ltOpen = before(MIN.open);
  const ltClose = g.mux(early, before(MIN.earlyClose), before(MIN.close));
  const ltPostEnd = g.mux(early, before(MIN.earlyPostEnd), before(MIN.postEnd));

  const overnight = g.and(inRange, g.or(g.and(trading, ltPre), g.and(g.not(before(MIN.postEnd)), tradingNext)));
  const pre = g.all([trading, g.not(ltPre), ltOpen]);
  const regular = g.all([trading, g.not(ltOpen), ltClose]);
  const post = g.all([trading, g.not(ltClose), ltPostEnd]);
  const closed = g.and(inRange, g.not(g.any([overnight, pre, regular, post])));

  return c.finish([
    g.any([pre, post, closed]),
    g.or(regular, post),
    g.or(overnight, closed),
    g.and(inRange, holiday),
    g.and(inRange, weekend),
    g.and(inRange, early),
  ]);
}

/** The circuit's input for a unix time. */
export function clockInput(unix: number): Hex {
  const day = BigInt(Math.floor(unix / 86_400));
  const minute = BigInt(Math.floor((unix % 86_400) / 60));
  return packBits([...toBits(day, CLOCK_DAY_BITS), ...toBits(minute, CLOCK_MINUTE_BITS)]);
}

export function readClock(bits: readonly boolean[]): ClockReading {
  const code = (bits[0] ? 1 : 0) + (bits[1] ? 2 : 0) + (bits[2] ? 4 : 0);
  return { session: CLOCK_SESSIONS[code] ?? "UNKNOWN", holiday: bits[3] ?? false, weekend: bits[4] ?? false, earlyClose: bits[5] ?? false };
}

export const readClockOutput = (out: Hex) => readClock(unpackBits(out, 6));

/** The same rules written plainly on `calendar.ts`: the reference the circuit is tested against. */
export function clockAt(unix: number, fromYear: number, toYear: number): ClockReading {
  const p = etParts(unix);
  const year = Number(p.date.slice(0, 4));
  if (year < fromYear || year > toYear) return { session: "UNKNOWN", holiday: false, weekend: false, earlyClose: false };
  const x = p.hour * 60 + p.minute;
  const f = dateFacts(p.date);
  const early = f.earlyClose;
  const close = early ? 780 : 960;
  const postEnd = early ? 1020 : 1200;
  let session: ClockSession;
  if (x >= 1200 && f.nextTrades) session = "OVERNIGHT";
  else if (!f.trades) session = "CLOSED";
  else if (x < 240) session = "OVERNIGHT";
  else if (x < 570) session = "PRE_MARKET";
  else if (x < close) session = "REGULAR";
  else if (x < postEnd) session = "POST_MARKET";
  else session = "CLOSED";
  return { session, holiday: f.holiday, weekend: p.weekday === 0 || p.weekday === 6, earlyClose: early };
}

const facts = new Map<EtDate, { trades: boolean; nextTrades: boolean; earlyClose: boolean; holiday: boolean }>();
function dateFacts(date: EtDate) {
  let f = facts.get(date);
  if (!f) {
    f = { trades: isTradingDay(date), nextTrades: isTradingDay(addDays(date, 1)), earlyClose: isEarlyClose(date), holiday: isHoliday(date) };
    facts.set(date, f);
  }
  return f;
}
