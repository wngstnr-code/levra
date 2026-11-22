import { etToUnix } from "@levra/shared/calendar";
import { describe, expect, it } from "vitest";
import { dayProgress, segmentShare, sessionSegments } from "./sessionBar";

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
