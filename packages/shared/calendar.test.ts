import { describe, expect, it } from "vitest";
import {
  REGULAR_SCHEDULE,
  etParts,
  etToUnix,
  isEarlyClose,
  isScheduledClosed,
  isTradingDay,
  nextCloseAfter,
  nextOpenAfter,
  nyseHolidays,
  scheduleFromStretches,
  type SessionSchedule,
} from "./calendar";

/** What BE-03 measured: the oracle goes CLOSED at 20:00 on Friday and is back at 20:00 on Sunday (04). */
const OBSERVED: SessionSchedule = { closeOffsetSeconds: 4 * 3600, openOffsetSeconds: -4 * 3600, source: "observed" };
const at = (date: string, hh: number, mm = 0) => etToUnix(date, hh * 3600 + mm * 60);
const clock = (unix: number) => {
  const p = etParts(unix);
  return `${p.date} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

describe("exchange calendar (BE-30)", () => {
  it("knows the NYSE holidays of 2026 and 2027 by rule", () => {
    expect([...nyseHolidays(2026).keys()].sort()).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-04-03",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03",
      "2026-09-07",
      "2026-11-26",
      "2026-12-25",
    ]);
    // 2027: New Year on a Friday, Juneteenth on a Saturday (Friday off), Christmas on a Saturday (Friday off).
    const h2027 = nyseHolidays(2027);
    expect(h2027.has("2027-06-18")).toBe(true);
    expect(h2027.has("2027-12-24")).toBe(true);
    expect(h2027.has("2027-07-05")).toBe(true);
    // New Year 2028 is a Saturday: not moved to Friday 31 December 2027.
    expect(nyseHolidays(2028).has("2027-12-31")).toBe(false);
    expect(isTradingDay("2027-12-31")).toBe(true);
  });

  it("knows the early closes", () => {
    expect(isEarlyClose("2026-11-27")).toBe(true);
    expect(isEarlyClose("2026-12-24")).toBe(true);
    // 4 July 2026 is a Saturday, so Friday 3 July is a holiday and there is no early close.
    expect(isEarlyClose("2026-07-03")).toBe(false);
    expect(isEarlyClose("2027-07-02")).toBe(false);
  });

  it("converts New York wall time across the daylight saving change", () => {
    // EDT (UTC-4) until Sunday 1 November 2026 02:00, then EST (UTC-5).
    expect(at("2026-10-30", 20)).toBe(Date.UTC(2026, 9, 31, 0) / 1000);
    expect(at("2026-11-06", 20)).toBe(Date.UTC(2026, 10, 7, 1) / 1000);
    expect(at("2027-03-12", 16)).toBe(Date.UTC(2027, 2, 12, 21) / 1000);
    expect(at("2027-03-19", 16)).toBe(Date.UTC(2027, 2, 19, 20) / 1000);
  });

  it("gives the next close for the next four weeks, including a holiday and a daylight saving change", () => {
    // From Monday 19 October 2026: four Fridays, the DST change on 1 November, and Thanksgiving on 26 November.
    let now = at("2026-10-19", 9);
    const closes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const close = nextCloseAfter(now, OBSERVED);
      closes.push(clock(close));
      now = close + 60;
    }
    expect(closes).toEqual([
      "2026-10-23 20:00",
      "2026-10-30 20:00",
      "2026-11-06 20:00",
      "2026-11-13 20:00",
      "2026-11-20 20:00",
      // Wednesday before Thanksgiving: Thursday has no trading.
      "2026-11-25 20:00",
    ]);
  });

  it("uses the regular close until a weekend is observed, and the early close on a short day", () => {
    expect(clock(nextCloseAfter(at("2026-10-19", 9), REGULAR_SCHEDULE))).toBe("2026-10-23 16:00");
    // Friday 27 November closes at 13:00 and is followed by a weekend.
    expect(clock(nextCloseAfter(at("2026-11-27", 9), REGULAR_SCHEDULE))).toBe("2026-11-27 13:00");
    // Christmas Eve 2026 is a Thursday with an early close before the holiday on Friday.
    expect(clock(nextCloseAfter(at("2026-12-22", 9), REGULAR_SCHEDULE))).toBe("2026-12-24 13:00");
  });

  it("learns the schedule from observed weekends, taking the first CLOSED write and not the last flip", () => {
    expect(scheduleFromStretches([])).toEqual(REGULAR_SCHEDULE);
    const learned = scheduleFromStretches([
      // Friday 20:00:07 first CLOSED write, back at Sunday 20:00:12.
      { firstClosedAt: at("2026-10-02", 20) + 7, reopenedAt: at("2026-10-04", 20) + 12 },
      { firstClosedAt: at("2026-10-09", 20) + 31, reopenedAt: at("2026-10-11", 20) + 3 },
    ]);
    expect(learned).toEqual({ closeOffsetSeconds: 4 * 3600, openOffsetSeconds: -4 * 3600 + 60, source: "observed" });
    expect(clock(nextCloseAfter(at("2026-10-19", 9), learned))).toBe("2026-10-23 20:00");
  });

  it("gives the next open and whether the market is closed now", () => {
    expect(clock(nextOpenAfter(at("2026-10-24", 12), OBSERVED))).toBe("2026-10-25 20:00");
    expect(clock(nextOpenAfter(at("2026-10-24", 12), REGULAR_SCHEDULE))).toBe("2026-10-26 09:30");
    // Thanksgiving: closed from Wednesday 20:00 to Thursday 20:00.
    expect(clock(nextOpenAfter(at("2026-11-25", 21), OBSERVED))).toBe("2026-11-26 20:00");
    expect(isScheduledClosed(at("2026-10-24", 12), OBSERVED)).toBe(true);
    expect(isScheduledClosed(at("2026-10-23", 19, 59), OBSERVED)).toBe(false);
    expect(isScheduledClosed(at("2026-10-23", 20), OBSERVED)).toBe(true);
    expect(isScheduledClosed(at("2026-10-25", 20, 1), OBSERVED)).toBe(false);
    expect(isScheduledClosed(at("2026-10-21", 3), OBSERVED)).toBe(false);
  });
});
