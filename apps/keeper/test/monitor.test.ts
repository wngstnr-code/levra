import { createDb, monitorState, runMigrations } from "@levra/db";
import { WAD } from "@levra/shared/math";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evaluate, oracleLimit, type Condition, type Finding, type Snapshot } from "../src/monitor/checks";
import { reconcile, type Notice } from "../src/monitor/job";
import { maxAgeRule } from "../src/oracle/max-age";

const NOW = 1_800_000_000;
const MARKET = "0xmarket";

/** Everything fine: open market, fresh price, no lag, money in the wallets. */
function healthy(): Snapshot {
  return {
    now: NOW,
    scheduleClosed: false,
    scheduleObserved: true,
    stocks: [{ symbol: "QQQ", session: "REGULAR", feedUpdatedAt: NOW - 60, priceE8: 60_000_000_000n, dexMidE8: 60_100_000_000n, maxDeviationBps: 300, limit: { limitSeconds: 1_800, learning: false } }],
    markets: [
      {
        marketId: MARKET,
        label: "QQQ long",
        side: "long",
        lltvWad: (77n * WAD) / 100n,
        maxOracleAge: 2_100,
        maxPositionUsdRaw: 500_000_000n,
        totalSupplyRaw: 1_000_000n,
        totalBorrowRaw: 500_000n,
        depth: [
          { direction: "sell", sizeUsdRaw: 300_000_000n, deviationBps: -150, measuredAt: NOW - 3_600 },
          { direction: "sell", sizeUsdRaw: 1_000_000_000n, deviationBps: -500, measuredAt: NOW - 3_600 },
        ],
      },
    ],
    nextCloseAt: NOW + 86_400,
    heartbeats: [{ name: "liquidator", lastBeatAt: NOW - 30, lastError: null }],
    wallets: [{ role: "liquidator", address: "0xkeeper", balanceWei: 20n * 10n ** 18n }],
    unhealthy: [],
    badDebt: [],
    indexer: [{ cursor: "morpho_events", lastBlock: 1_000n }],
    head: 1_010n,
    api: { ok: true, ms: 200, detail: "status 200" },
  };
}

const active = (findings: Finding[]) => findings.filter((f): f is Condition => f.kind === "condition" && f.active).map((f) => f.key);

describe("team monitor checks (08, one per row)", () => {
  it("raises nothing when all is well", () => {
    expect(active(evaluate(healthy()))).toEqual([]);
    expect(evaluate(healthy()).filter((f) => f.kind === "event")).toEqual([]);
  });

  it("triggers each row on purpose", () => {
    const cases: [string, (s: Snapshot) => void][] = [
      ["oracle-age:QQQ", (s) => (s.stocks[0]!.feedUpdatedAt = NOW - 1_801)],
      ["session:QQQ", (s) => (s.stocks[0]!.session = "CLOSED")],
      ["dex-deviation:QQQ", (s) => (s.stocks[0]!.dexMidE8 = 62_000_000_000n)],
      ["heartbeat:liquidator", (s) => (s.heartbeats[0]!.lastBeatAt = NOW - 301)],
      ["balance:liquidator", (s) => (s.wallets[0]!.balanceWei = 10n ** 18n)],
      ["unhealthy:QQQ long:0xborrower", (s) => s.unhealthy.push({ borrower: "0xBorrower", label: "QQQ long" })],
      [`utilization:${MARKET}`, (s) => (s.markets[0]!.totalBorrowRaw = 960_000n)],
      [`depth:${MARKET}`, (s) => (s.markets[0]!.depth[1]!.deviationBps = -800)],
      ["indexer:morpho_events", (s) => (s.head = 1_400n)],
      ["api", (s) => (s.api = { ok: false, ms: 10_000, detail: "timeout" })],
    ];
    for (const [key, change] of cases) {
      const s = healthy();
      change(s);
      expect(active(evaluate(s)), key).toEqual([key]);
    }
    const errored = healthy();
    errored.heartbeats[0]!.lastError = "rpc down";
    expect(evaluate(errored).find((f) => f.key === "heartbeat:liquidator")).toMatchObject({ active: true, message: "Keeper liquidator reports an error: rpc down" });

    const debt = healthy();
    debt.badDebt.push({ txHash: "0xtx", logIndex: 2, label: "QQQ long", borrower: "0xb", badDebtAssets: 5n, at: NOW - 60 });
    expect(evaluate(debt).filter((f) => f.kind === "event").map((f) => f.key)).toEqual(["bad-debt:0xtx:2"]);

    const values = evaluate(healthy()).filter((f) => f.kind === "value").map((f) => [f.key, f.value]);
    expect(values).toEqual([
      [`max-oracle-age:${MARKET}`, "2100"],
      ["next-close-at", String(NOW + 86_400)],
    ]);
  });

  it("raises nothing over a normal weekend: closed by the calendar, CLOSED on the oracle, no updates", () => {
    const s = healthy();
    s.scheduleClosed = true;
    s.stocks[0]!.session = "CLOSED";
    s.stocks[0]!.feedUpdatedAt = NOW - 2 * 86_400;
    s.stocks[0]!.dexMidE8 = 70_000_000_000n;
    expect(active(evaluate(s))).toEqual([]);
  });

  it("waits half an hour on a session mismatch, so the Friday flips pass, and skips it until a weekend is observed", () => {
    const s = healthy();
    s.scheduleClosed = true;
    s.stocks[0]!.session = "POST_MARKET";
    expect(evaluate(s).find((f) => f.key === "session:QQQ")).toMatchObject({ active: true, forSeconds: 1_800 });
    s.scheduleObserved = false;
    expect(evaluate(s).find((f) => f.key === "session:QQQ")).toMatchObject({ active: false });
  });

  it("does not judge a depth run that is too old or has no size as large as the cap", () => {
    const s = healthy();
    s.markets[0]!.depth[1]!.deviationBps = -800;
    s.markets[0]!.depth[1]!.measuredAt = NOW - 3 * 86_400;
    expect(evaluate(s).some((f) => f.key === `depth:${MARKET}`)).toBe(false);
  });

  it("takes the oracle limit per session from the data, and the strict default while learning", () => {
    expect(oracleLimit(undefined, 2_100, maxAgeRule)).toEqual({ limitSeconds: 2_100, learning: true });
    expect(oracleLimit({ p99: 900, n: 100 }, 2_100, maxAgeRule)).toEqual({ limitSeconds: 2_100, learning: true });
    expect(oracleLimit({ p99: 1_000, n: 5_000 }, 2_100, maxAgeRule)).toEqual({ limitSeconds: 1_620, learning: false });
    expect(oracleLimit({ p99: 4_000, n: 5_000 }, 2_100, maxAgeRule)).toEqual({ limitSeconds: 4_620, learning: false });
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("team alerts sent once and resolved (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const sent: string[] = [];
  let failing = false;
  const send = async (n: Notice) => {
    if (failing) throw new Error("channel down");
    sent.push(n.text);
  };
  const at = (s: number) => new Date((NOW + s) * 1000);
  const cond = (key: string, isActive: boolean, forSeconds = 0): Finding => ({ kind: "condition", key, active: isActive, forSeconds, message: `${key} message` });

  beforeAll(() => runMigrations(url ?? ""));
  beforeEach(async () => {
    await db.delete(monitorState).where(like(monitorState.key, "t-%"));
    sent.length = 0;
    failing = false;
  });
  afterAll(async () => {
    await db.delete(monitorState).where(like(monitorState.key, "t-%"));
    await close();
  });

  it("alerts a condition once after its wait, and resolves it when it ends", async () => {
    await reconcile(db, [cond("t-session", true, 1_800)], at(0), send);
    await reconcile(db, [cond("t-session", true, 1_800)], at(900), send);
    expect(sent).toEqual([]);
    await reconcile(db, [cond("t-session", true, 1_800)], at(1_800), send);
    await reconcile(db, [cond("t-session", true, 1_800)], at(1_900), send);
    expect(sent).toEqual(["ALERT: t-session message"]);
    await reconcile(db, [cond("t-session", false, 1_800)], at(2_000), send);
    expect(sent).toEqual(["ALERT: t-session message", "RESOLVED: t-session message"]);
  });

  it("stays quiet when a condition ends before its wait, as the Friday flips do", async () => {
    await reconcile(db, [cond("t-flip", true, 1_800)], at(0), send);
    await reconcile(db, [cond("t-flip", false, 1_800)], at(900), send);
    await reconcile(db, [cond("t-flip", true, 1_800)], at(1_000), send);
    await reconcile(db, [cond("t-flip", true, 1_800)], at(2_000), send);
    expect(sent).toEqual([]);
  });

  it("reports a risk value change with the old and new value, but not the first value seen", async () => {
    const value = (v: string): Finding => ({ kind: "value", key: "t-age", value: v, describe: (a, b) => `from ${a} to ${b}` });
    await reconcile(db, [value("2100")], at(0), send);
    await reconcile(db, [value("2100")], at(60), send);
    await reconcile(db, [value("2700")], at(120), send);
    expect(sent).toEqual(["CHANGE: from 2100 to 2700"]);
  });

  it("retries a notice whose send failed, and sends an event once", async () => {
    failing = true;
    await reconcile(db, [cond("t-api", true), { kind: "event", key: "t-bad-debt", message: "bad debt" }], at(0), send);
    failing = false;
    await reconcile(db, [cond("t-api", true), { kind: "event", key: "t-bad-debt", message: "bad debt" }], at(60), send);
    await reconcile(db, [cond("t-api", true), { kind: "event", key: "t-bad-debt", message: "bad debt" }], at(120), send);
    expect(sent.sort()).toEqual(["ALERT: bad debt", "ALERT: t-api message"]);
  });
});
