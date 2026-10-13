import { describe, expect, it } from "vitest";
import { yahooBars } from "../src/gaps/source";

const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("daily prices for the gap table", () => {
  it("reads the bars dated in New York time and skips days with a missing price", async () => {
    // 13:30 UTC is 09:30 in New York in summer (offset -4 h).
    const t = Date.UTC(2026, 9, 9, 13, 30) / 1000;
    const bars = await yahooBars({
      fetchFn: answer({
        chart: {
          result: [{ meta: { gmtoffset: -14_400 }, timestamp: [t, t + 3 * 86_400, t + 4 * 86_400], indicators: { quote: [{ open: [600, 590, null], close: [605, 592, 593] }] } }],
          error: null,
        },
      }),
    })("QQQ");
    expect(bars).toEqual([
      { date: "2026-10-09", open: 600, close: 605 },
      { date: "2026-10-12", open: 590, close: 592 },
    ]);
  });

  it("fails clearly when the source refuses or answers something else", async () => {
    await expect(yahooBars({ fetchFn: answer({}, 429) })("QQQ")).rejects.toThrow(/answered 429/);
    await expect(yahooBars({ fetchFn: answer({ chart: { result: null, error: { code: "Not Found" } } }) })("XXX")).rejects.toThrow(/unknown answer/);
  });
});