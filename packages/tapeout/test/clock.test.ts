import { etToUnix } from "@levra/shared/calendar";
import { describe, expect, it } from "vitest";
import { clockAt, clockInput, clockTables, compileNand, readClock, unpackBits, wallStreetClock } from "../src";

const FROM = 2026;
const TO = 2030;
const clock = wallStreetClock(FROM, TO);
const run = compileNand(clock.gates, clock.nIn, clock.nOut);
const circuitAt = (unix: number) => readClock(run(unpackBits(clockInput(unix), clock.nIn)));

function expectSame(unix: number) {
  const want = clockAt(unix, FROM, TO);
  const got = circuitAt(unix);
  if (got.session !== want.session || got.holiday !== want.holiday || got.weekend !== want.weekend || got.earlyClose !== want.earlyClose) {
    expect({ at: new Date(unix * 1000).toISOString(), ...got }).toEqual({ at: new Date(unix * 1000).toISOString(), ...want });
  }
}

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
/** The two sweeps run hundreds of thousands of moments through 4,850 gates: about 20 s together. */
const SWEEP_TIMEOUT_MS = 120_000;

describe("Wall Street Clock circuit (BE-86)", () => {
  it("is small enough to tape out and eval on X Layer", () => {
    console.log(`clock ${FROM} to ${TO}: ${clock.gates.length} NAND, ${clock.nIn} inputs, ${clock.nOut} outputs`);
    // Tape out about 210,000 gas plus 2,900 per gate and eval about 50,000 plus 2,500 per gate (05): both well under
    // the 210 million block gas limit and the usual RPC call cap.
    expect(clock.gates.length).toBeLessThan(10_000);
  });

  it("builds its tables from calendar.ts", () => {
    const t = clockTables(2026, 2026);
    expect(t.holidays).toContain(day("2026-11-26") / 86_400);
    expect(t.earlyCloses).toEqual([day("2026-11-27") / 86_400, day("2026-12-24") / 86_400]);
    // 2026: daylight saving from 8 March 07:00 UTC to 1 November 06:00 UTC.
    expect(t.dst).toEqual([[BigInt(day("2026-03-08") / 86_400) * 2048n + 420n, BigInt(day("2026-11-01") / 86_400) * 2048n + 360n]]);
  });

  it("reads known moments", () => {
    const et = (date: string, h: number, m = 0) => etToUnix(date, h * 3600 + m * 60);
    expect(circuitAt(et("2026-11-23", 10))).toEqual({ session: "REGULAR", holiday: false, weekend: false, earlyClose: false });
    expect(circuitAt(et("2026-11-23", 9, 29)).session).toBe("PRE_MARKET");
    expect(circuitAt(et("2026-11-23", 3, 59)).session).toBe("OVERNIGHT");
    expect(circuitAt(et("2026-11-26", 12))).toEqual({ session: "CLOSED", holiday: true, weekend: false, earlyClose: false });
    expect(circuitAt(et("2026-11-26", 20)).session).toBe("OVERNIGHT");
    expect(circuitAt(et("2026-11-27", 13)).session).toBe("POST_MARKET");
    expect(circuitAt(et("2026-11-27", 17)).session).toBe("CLOSED");
    expect(circuitAt(et("2026-11-28", 12))).toEqual({ session: "CLOSED", holiday: false, weekend: true, earlyClose: false });
    expect(circuitAt(et("2026-11-29", 20)).session).toBe("OVERNIGHT");
    expect(circuitAt(et("2025-12-31", 12)).session).toBe("UNKNOWN");
    expect(circuitAt(et("2031-01-02", 12)).session).toBe("UNKNOWN");
  });

  it("matches calendar.ts across every year it covers, one sample every 37 minutes", () => {
    for (let t = day("2025-12-30"); t < day("2031-01-03"); t += 37 * 60) expectSame(t);
  }, SWEEP_TIMEOUT_MS);

  it("matches calendar.ts on every boundary minute of holidays, early closes and daylight saving changes", () => {
    const t = clockTables(FROM, TO);
    const special = new Set<number>([...t.holidays, ...t.holidaysNext, ...t.earlyCloses, ...t.dst.flatMap(([s, e]) => [Number(s / 2048n), Number(e / 2048n)])]);
    special.add(day("2026-01-01") / 86_400);
    special.add(day("2030-12-31") / 86_400);
    for (const d of special) {
      for (let t = (d - 1) * 86_400; t < (d + 2) * 86_400; t += 300) {
        expectSame(t);
        expectSame(t + 240);
      }
    }
  }, SWEEP_TIMEOUT_MS);
});
