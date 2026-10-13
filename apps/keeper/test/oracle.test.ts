import { describe, expect, it } from "vitest";
import { sessionFromIndex, toOracleRow } from "../src/oracle/decode";
import { proposeMaxOracleAge } from "../src/oracle/max-age";
import { findClosedStretches } from "../src/oracle/report";
import { sampleLog } from "./fixtures";

describe("decode", () => {
  it("maps a log to a row with the stock symbol and session name", () => {
    const row = toOracleRow(sampleLog());
    expect(row).toMatchObject({
      symbol: "QQQ",
      priceE8: "74562000000",
      bestBidE8: "74500000000",
      session: "REGULAR",
      roundId: "12111",
      blockNumber: 100n,
    });
    expect(row.feedUpdatedAt.getTime()).toBe(1_791_876_162_000);
    expect(row.blockTime.getTime()).toBe(1_791_876_168_000);
  });

  it("rejects a price id we do not track and an unknown session", () => {
    expect(() => toOracleRow(sampleLog({ priceId: `0x${"ab".repeat(32)}` }))).toThrow(/do not track/);
    expect(() => sessionFromIndex(6)).toThrow(/Unknown oracle session/);
  });
});

describe("maxOracleAge rule", () => {
  const enough = { p99AgeSeconds: 1500, samples: 10_000, spanSeconds: 14 * 86_400, fullWeekends: 2 };

  it("adds one heartbeat to the p99 age and rounds up to a minute", () => {
    expect(proposeMaxOracleAge({ ...enough, p99AgeSeconds: 1_431 })).toEqual({ value: 2_040, reason: null });
  });

  it("never goes below 1,500 seconds", () => {
    expect(proposeMaxOracleAge({ ...enough, p99AgeSeconds: 100 }).value).toBe(1_500);
  });

  it("proposes nothing without enough data", () => {
    expect(proposeMaxOracleAge({ ...enough, spanSeconds: 6 * 86_400 }).value).toBeNull();
    expect(proposeMaxOracleAge({ ...enough, fullWeekends: 0 }).value).toBeNull();
    expect(proposeMaxOracleAge({ ...enough, samples: 499 }).value).toBeNull();
  });
});

describe("closed stretches", () => {
  const at = (iso: string) => new Date(iso);

  it("counts only stretches where both the start and the end were seen", () => {
    const stretches = findClosedStretches([
      { symbol: "QQQ", prev: "OVERNIGHT", session: "REGULAR", at: at("2026-10-09T13:30:00Z") },
      { symbol: "QQQ", prev: "POST_MARKET", session: "CLOSED", at: at("2026-10-10T00:05:00Z") },
      { symbol: "QQQ", prev: "CLOSED", session: "OVERNIGHT", at: at("2026-10-12T00:05:00Z") },
      { symbol: "QQQ", prev: "POST_MARKET", session: "CLOSED", at: at("2026-10-17T00:05:00Z") },
    ]);
    expect(stretches).toHaveLength(1);
    expect(stretches[0]?.hours).toBe(48);
  });
});
