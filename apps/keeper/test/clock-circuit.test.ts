import { FEED_SCHEDULE, REGULAR_SCHEDULE, etToUnix, nextCloseAfter, type SessionSchedule } from "@levra/shared/calendar";
import { CLOCK_YEARS, clockAt, clockInput, compileNand, readClock, unpackBits, wallStreetClock, type ClockReading } from "@levra/tapeout";
import { describe, expect, it } from "vitest";
import { UNREADABLE_RUNS, checkClose, clockAlerts, closeFromClock, memoClock, type ClockSource } from "../src/calendar/clock-circuit";

const [FROM, TO] = CLOCK_YEARS;
/** The plain reference of the circuit (BE-86 tests the two against each other). */
const reference: ClockSource = async (unix) => clockAt(unix, FROM, TO);
const at = (date: string, hour: number, minute = 0) => etToUnix(date, hour * 3600 + minute * 60);
const iso = (unix: number | null) => (unix === null ? null : new Date(unix * 1000).toISOString());

describe("next close from the Wall Street Clock circuit (D-113)", { timeout: 120_000 }, () => {
  function sweep(schedule: SessionSchedule, from: number, to: number, step: number) {
    const clock = memoClock(reference, 100_000);
    return (async () => {
      const wrong: string[] = [];
      for (let now = from; now < to; now += step) {
        const got = await closeFromClock(now, schedule, clock);
        const want = nextCloseAfter(now, schedule);
        if (got !== want) wrong.push(`${iso(now)}: circuit ${iso(got)}, calendar ${iso(want)}`);
      }
      return wrong;
    })();
  }

  it("matches calendar.ts every hour through 2026 and 2027 with the feed schedule of Base and X Layer", async () => {
    expect(await sweep(FEED_SCHEDULE, at("2026-01-02", 0), at("2027-12-20", 0), 3_600)).toEqual([]);
  });

  it("matches calendar.ts with the regular schedule, early closes and daylight saving included", async () => {
    expect(await sweep(REGULAR_SCHEDULE, at("2026-01-02", 0), at("2027-12-20", 0), 3_600)).toEqual([]);
  });

  it("gives the same closes from the real circuit around Thanksgiving, 3 July and a daylight saving change", async () => {
    const circuit = wallStreetClock(FROM, TO);
    const run = compileNand(circuit.gates, circuit.nIn, circuit.nOut);
    const clock = memoClock(async (unix) => readClock(run(unpackBits(clockInput(unix), circuit.nIn))));
    for (const now of [at("2026-11-24", 10), at("2026-11-25", 17), at("2026-11-27", 9), at("2026-07-02", 12), at("2026-03-06", 12), at("2026-10-30", 21)]) {
      expect(iso(await closeFromClock(now, FEED_SCHEDULE, clock))).toBe(iso(nextCloseAfter(now, FEED_SCHEDULE)));
    }
    expect(iso(await closeFromClock(at("2026-11-24", 10), FEED_SCHEDULE, clock))).toBe("2026-11-25T21:00:00.000Z");
    expect(iso(await closeFromClock(at("2026-11-25", 17), FEED_SCHEDULE, clock))).toBe("2026-11-27T18:00:00.000Z");
  });

  it("finds no close outside the circuit's years", async () => {
    expect(await closeFromClock(at(`${TO}-12-30`, 12), FEED_SCHEDULE, reference)).toBeNull();
  });
});

describe("checking the calendar's close against the circuit", () => {
  const now = at("2026-11-24", 10);
  const close = nextCloseAfter(now, FEED_SCHEDULE);
  const shifted: ClockSource = async (unix) => clockAt(unix + 3_600, FROM, TO);
  const broken: ClockSource = async () => {
    throw new Error("rate limited");
  };

  it("agrees, differs or cannot read", async () => {
    expect(await checkClose(now, FEED_SCHEDULE, close, reference)).toEqual({ status: "agrees", close });
    expect(await checkClose(now, FEED_SCHEDULE, close, shifted)).toMatchObject({ status: "differs", close, circuit: close - 3_600 });
    expect(await checkClose(now, FEED_SCHEDULE, close, broken)).toEqual({ status: "unreadable", close, error: "rate limited" });
    const hangs: ClockSource = () => new Promise(() => {});
    expect(await checkClose(now, FEED_SCHEDULE, close, hangs, 50)).toEqual({ status: "unreadable", close, error: "no answer in 0.05 s" });
  });

  it("tells the team once per problem, waits for a few unreadable runs, and tells when it ends", async () => {
    const tell = clockAlerts("X Layer");
    const agrees = await checkClose(now, FEED_SCHEDULE, close, reference);
    const differs = await checkClose(now, FEED_SCHEDULE, close, shifted);
    const unreadable = await checkClose(now, FEED_SCHEDULE, close, broken);

    expect(tell(agrees)).toBeNull();
    expect(tell(differs)).toContain("circuit gives 2026-11-25T20:00:00.000Z, calendar.ts gives 2026-11-25T21:00:00.000Z");
    expect(tell(differs)).toBeNull();
    expect(tell(agrees)).toContain("agrees with calendar.ts again");
    for (let i = 1; i < UNREADABLE_RUNS; i++) expect(tell(unreadable)).toBeNull();
    expect(tell(unreadable)).toContain("could not be read");
    expect(tell(unreadable)).toBeNull();
    expect(tell(agrees)).toContain("agrees");
  });

  it("asks again after a failed read but keeps a good answer", async () => {
    let calls = 0;
    let fail = true;
    const clock = memoClock(async (unix): Promise<ClockReading> => {
      calls++;
      if (fail) throw new Error("down");
      return clockAt(unix, FROM, TO);
    });
    await expect(clock(now)).rejects.toThrow("down");
    fail = false;
    await clock(now);
    await clock(now);
    expect(calls).toBe(2);
  });
});
