import { createDb, oracleUpdates, observedClosedStretches, runMigrations } from "@levra/db";
import { REGULAR_SCHEDULE, etParts, etToUnix, nextCloseAfter, scheduleFromStretches, type SessionSchedule } from "@levra/shared/calendar";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideNextClose } from "../src/calendar/poster";

const at = (date: string, hour: number, minute = 0) => etToUnix(date, hour * 3600 + minute * 60);
const clock = (unix: number) => {
  const p = etParts(unix);
  return `${p.date} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

describe("when to post nextCloseAt", () => {
  it("posts when nothing is on chain and when a close is wrong, and leaves a correct one alone", () => {
    const now = at("2026-11-16", 10);
    expect(decideNextClose({ now, current: 0, next: at("2026-11-20", 16) })).toMatchObject({ action: "post", value: at("2026-11-20", 16) });
    expect(decideNextClose({ now, current: at("2026-11-20", 16), next: at("2026-11-20", 20) })).toMatchObject({ action: "post", reason: expect.stringContaining("corrected") });
    expect(decideNextClose({ now, current: at("2026-11-20", 16), next: at("2026-11-20", 16) }).action).toBe("skip");
  });

  it("keeps a close that just passed through the grace hour, then moves on", () => {
    const close = at("2026-11-20", 16);
    const next = at("2026-11-25", 16);
    expect(decideNextClose({ now: close + 1_800, current: close, next }).action).toBe("skip");
    expect(decideNextClose({ now: close + 3_600, current: close, next })).toMatchObject({ action: "post", value: next });
  });

  it("never posts beyond the contract's 8-day horizon", () => {
    const now = at("2026-11-16", 10);
    expect(decideNextClose({ now, current: 0, next: now + 9 * 86_400 }).action).toBe("skip");
  });

  /** Runs the job's decision every 10 minutes and records what the chain would hold. */
  function simulate(from: number, to: number, schedule: SessionSchedule) {
    let current = 0;
    const posted: number[] = [];
    for (let now = from; now < to; now += 600) {
      const d = decideNextClose({ now, current, next: nextCloseAfter(now, schedule) });
      if (d.action === "post") {
        current = d.value;
        posted.push(d.value);
      }
      // Outside the grace hour, the chain always holds a close in the future.
      if (now >= current + 3_600) throw new Error(`no future close on chain at ${clock(now)}`);
    }
    return posted.map(clock);
  }

  it("holds the right close for four weeks around Thanksgiving with the regular schedule", () => {
    expect(simulate(at("2026-11-16", 0), at("2026-12-14", 0), REGULAR_SCHEDULE)).toEqual([
      "2026-11-20 16:00",
      "2026-11-25 16:00",
      "2026-11-27 13:00",
      "2026-12-04 16:00",
      "2026-12-11 16:00",
      // Posted an hour after the last close in the range.
      "2026-12-18 16:00",
    ]);
  });

  it("holds the observed close once a weekend is in the data", () => {
    const observed: SessionSchedule = { closeOffsetSeconds: 4 * 3600, openOffsetSeconds: -4 * 3600, source: "observed" };
    expect(simulate(at("2026-11-16", 0), at("2026-11-30", 0), observed)).toEqual(["2026-11-20 20:00", "2026-11-25 20:00", "2026-11-27 17:00", "2026-12-04 20:00"]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const SYMBOL = "CALTEST";

describe.skipIf(!url)("observed closes from the oracle logger (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  let n = 0;
  const update = (session: string, time: number) => {
    n += 1;
    return {
      symbol: SYMBOL,
      priceId: "0x00",
      roundId: String(n),
      priceE8: "1",
      bestBidE8: "0",
      bestAskE8: "0",
      session,
      feedUpdatedAt: new Date(time * 1000),
      publishedAt: new Date(time * 1000),
      blockNumber: BigInt(n),
      blockTime: new Date(time * 1000),
      txHash: `0xca1${String(n).padStart(61, "0")}`,
      logIndex: 0,
    };
  };

  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(oracleUpdates).where(eq(oracleUpdates.symbol, SYMBOL));
    // Friday close at 20:00 ET with flips back to POST_MARKET, reopening Sunday 20:00 ET.
    await db.insert(oracleUpdates).values([
      update("POST_MARKET", at("2026-10-09", 19, 50)),
      update("CLOSED", at("2026-10-09", 20, 0)),
      update("POST_MARKET", at("2026-10-09", 20, 5)),
      update("CLOSED", at("2026-10-09", 20, 12)),
      update("CLOSED", at("2026-10-10", 12)),
      update("OVERNIGHT", at("2026-10-11", 20, 0)),
    ]);
  });
  afterAll(async () => {
    await db.delete(oracleUpdates).where(eq(oracleUpdates.symbol, SYMBOL));
    await close();
  });

  it("finds the weekend from the first CLOSED write and turns it into the schedule", async () => {
    const mine = (await observedClosedStretches(db)).filter((s) => s.symbol === SYMBOL);
    expect(mine).toEqual([{ symbol: SYMBOL, firstClosedAt: at("2026-10-09", 20), reopenedAt: at("2026-10-11", 20) }]);
    const schedule = scheduleFromStretches(mine);
    expect(schedule).toEqual({ closeOffsetSeconds: 4 * 3600, openOffsetSeconds: -4 * 3600, source: "observed" });
    expect(clock(nextCloseAfter(at("2026-10-12", 9), schedule))).toBe("2026-10-16 20:00");
  });
});
