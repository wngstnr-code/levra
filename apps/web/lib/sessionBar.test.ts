import { etToUnix } from "@levra/shared/calendar";
import { describe, expect, it } from "vitest";
import { calendarSession, dayProgress, segmentShare, sessionSegments } from "./sessionBar";

describe("session bar", () => {
  it("covers a whole day", () => {
    expect(sessionSegments.reduce((a, s) => a + segmentShare(s), 0)).toBeCloseTo(1);
  });

  it("puts 04:00 ET at the start and 16:00 ET at the half", () => {
    expect(dayProgress(etToUnix("2026-11-18", 4 * 3600))).toBeCloseTo(0);
    expect(dayProgress(etToUnix("2026-11-18", 16 * 3600))).toBeCloseTo(0.5);
  });

  it("wraps the night after midnight", () => {
    expect(dayProgress(etToUnix("2026-11-19", 2 * 3600))).toBeCloseTo(22 / 24);
  });
});

describe("calendarSession", () => {
  const at = (date: string, h: number) => etToUnix(date as Parameters<typeof etToUnix>[0], h * 3600);
  it("follows a normal Tuesday", () => {
    expect(calendarSession(at("2026-11-24", 1))).toBe("OVERNIGHT");
    expect(calendarSession(at("2026-11-24", 5))).toBe("PRE_MARKET");
    expect(calendarSession(at("2026-11-24", 10))).toBe("REGULAR");
    expect(calendarSession(at("2026-11-24", 17))).toBe("POST_MARKET");
    expect(calendarSession(at("2026-11-24", 21))).toBe("OVERNIGHT");
  });
  it("is closed from Friday night to Sunday 20:00", () => {
    expect(calendarSession(at("2026-11-20", 21))).toBe("CLOSED");
    expect(calendarSession(at("2026-11-22", 12))).toBe("CLOSED");
    expect(calendarSession(at("2026-11-22", 21))).toBe("OVERNIGHT");
  });
  it("is closed on Thanksgiving and ends regular hours early the day after", () => {
    expect(calendarSession(at("2026-11-26", 11))).toBe("CLOSED");
    expect(calendarSession(at("2026-11-27", 12))).toBe("REGULAR");
    expect(calendarSession(at("2026-11-27", 14))).toBe("POST_MARKET");
  });
});
