import { activeGates, createDb, gateSymbol, monitorState, runMigrations } from "@levra/db";
import { WAD } from "@levra/shared/math";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evaluate, oracleLimit, type Condition, type Finding, type Snapshot } from "../src/monitor/checks";
import { reconcile, rootDisk, type Notice } from "../src/monitor/job";
import { maxAgeRule } from "../src/oracle/max-age";

const NOW = 1_800_000_000;
const MARKET = "0xmarket";

/** Everything fine: open market, fresh price, no lag, money in the wallets. */
function healthy(): Snapshot {
  return {
    chainId: 143,
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
    gaps: [{ symbol: "QQQ", table: { over2PctShareBps: 310, worstDropBps: -540, worstRiseBps: 390 }, fresh: { over2PctShareBps: 290, worstDropBps: -540, worstRiseBps: 390 } }],
    lossBudgets: [{ token: "0xUSDC", label: "USDC", budget: 0n }],
    gates: [{ key: "gate:anchored-denylist:Morpho", blocked: false, message: "Anchored compliance denylists Morpho" }],
    backups: [
      { kind: "backup", finishedAt: NOW - 3_600, ok: true, error: null },
      { kind: "restore_check", finishedAt: NOW - 86_400, ok: true, error: null },
    ],
    disk: { usedPct: 12, freeBytes: 107e9 },
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
      ["gap-table:QQQ", (s) => (s.gaps[0]!.fresh = { over2PctShareBps: 320, worstDropBps: -610, worstRiseBps: 390 })],
      ["gate:anchored-denylist:Morpho", (s) => (s.gates[0]!.blocked = true)],
      ["gate:anchored-denylist:Morpho:unread", (s) => (s.gates[0]!.blocked = null)],
      ["backup:backup", (s) => (s.backups![0]!.finishedAt = NOW - 26 * 3_600 - 1)],
      ["backup:restore_check", (s) => (s.backups![1]!.ok = false)],
      ["disk", (s) => (s.disk = { usedPct: 80, freeBytes: 25e9 })],
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
      ["loss-budget:0xusdc", "0"],
    ]);
  });

  it("tells the team about a failed, late or missing backup, only in the monitor that watches them (BE-53)", () => {
    const message = (s: Snapshot, kind: string) => evaluate(s).find((f) => f.key === `backup:${kind}`);
    const failed = healthy();
    failed.backups![0] = { kind: "backup", finishedAt: NOW - 60, ok: false, error: "the dump was not copied off the server" };
    expect(message(failed, "backup")).toMatchObject({ active: true, message: "The last database backup failed: the dump was not copied off the server" });

    const late = healthy();
    late.backups![1]!.finishedAt = NOW - 8 * 86_400;
    expect(message(late, "restore_check")).toMatchObject({ active: true, message: "The last restore check was 192 h ago, above the 170 h limit." });
    late.backups![1]!.finishedAt = NOW - 7 * 86_400 - 2 * 3_600;
    expect(message(late, "restore_check")).toMatchObject({ active: false });

    const none = healthy();
    none.backups = [];
    expect(active(evaluate(none))).toEqual(["backup:backup", "backup:restore_check"]);
    expect(message(none, "backup")).toMatchObject({ message: "No database backup has been recorded yet." });

    const elsewhere = healthy();
    delete elsewhere.backups;
    expect(evaluate(elsewhere).filter((f) => f.key.startsWith("backup:"))).toEqual([]);
  });

  it("tells the team when the server disk fills, only in the monitor that watches it", () => {
    const disk = (s: Snapshot) => evaluate(s).find((f) => f.key === "disk");
    const full = healthy();
    full.disk = { usedPct: 93, freeBytes: 8.75e9 };
    expect(disk(full)).toMatchObject({ active: true, forSeconds: 300, message: expect.stringContaining("93% full (8.8 GB free)") });
    full.disk = { usedPct: 79, freeBytes: 26e9 };
    expect(disk(full)).toMatchObject({ active: false });

    const unread = healthy();
    unread.disk = null;
    expect(disk(unread)).toBeUndefined();
    const elsewhere = healthy();
    delete elsewhere.disk;
    expect(disk(elsewhere)).toBeUndefined();
  });

  it("reads the disk use like df", async () => {
    const d = await rootDisk(process.cwd());
    expect(d.usedPct).toBeGreaterThanOrEqual(0);
    expect(d.usedPct).toBeLessThanOrEqual(100);
    expect(d.freeBytes).toBeGreaterThan(0);
  });

  it("tells the team when the liquidator's loss budget is set or spent (BE-89)", () => {
    const budget = evaluate(healthy()).find((f) => f.key === "loss-budget:0xusdc");
    expect(budget?.kind).toBe("value");
    if (budget?.kind !== "value") return;
    expect(budget.describe("0", "50000000")).toBe("Liquidator loss budget for USDC changed from 0 to 50000000 base units. The owner added to it (LossBudgetSet).");
    expect(budget.describe("50000000", "49999990")).toContain("A liquidation lost money (LossBudgetSpent) or the owner cleared it.");
    const none = healthy();
    none.lossBudgets = [];
    expect(evaluate(none).some((f) => f.key.startsWith("loss-budget:"))).toBe(false);
  });

  it("judges a keeper wallet against the gas token and limit of its chain", () => {
    const low = (chainId: 143 | 8453 | 196, balanceWei: bigint) => {
      const s = healthy();
      s.chainId = chainId;
      s.wallets[0]!.balanceWei = balanceWei;
      return evaluate(s).find((f) => f.key === "balance:liquidator") as Condition;
    };
    // 0.01 ETH is plenty on Base, 0.01 OKB is not on X Layer, 0.01 MON is not on Monad.
    expect(low(8453, 10n ** 16n).active).toBe(false);
    expect(low(196, 10n ** 16n)).toMatchObject({ active: true, message: "liquidator wallet 0xkeeper has 0.01 OKB, below 0.05 OKB." });
    expect(low(143, 10n ** 16n)).toMatchObject({ active: true, message: "liquidator wallet 0xkeeper has 0.01 MON, below 5 MON." });
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

  it("waits when the daily prices could not be read, and does not alert a milder gap", () => {
    const s = healthy();
    s.gaps[0]!.fresh = null;
    expect(evaluate(s).some((f) => f.key === "gap-table:QQQ")).toBe(false);
    s.gaps[0]!.fresh = { over2PctShareBps: 100, worstDropBps: -300, worstRiseBps: 200 };
    expect(active(evaluate(s))).toEqual([]);
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
    await reconcile(db, 143, [cond("t-session", true, 1_800)], at(0), send);
    await reconcile(db, 143, [cond("t-session", true, 1_800)], at(900), send);
    expect(sent).toEqual([]);
    await reconcile(db, 143, [cond("t-session", true, 1_800)], at(1_800), send);
    await reconcile(db, 143, [cond("t-session", true, 1_800)], at(1_900), send);
    expect(sent).toEqual(["ALERT: t-session message"]);
    await reconcile(db, 143, [cond("t-session", false, 1_800)], at(2_000), send);
    expect(sent).toEqual(["ALERT: t-session message", "RESOLVED: t-session message"]);
  });

  it("stays quiet when a condition ends before its wait, as the Friday flips do", async () => {
    await reconcile(db, 143, [cond("t-flip", true, 1_800)], at(0), send);
    await reconcile(db, 143, [cond("t-flip", false, 1_800)], at(900), send);
    await reconcile(db, 143, [cond("t-flip", true, 1_800)], at(1_000), send);
    await reconcile(db, 143, [cond("t-flip", true, 1_800)], at(2_000), send);
    expect(sent).toEqual([]);
  });

  it("reports a risk value change with the old and new value, but not the first value seen", async () => {
    const value = (v: string): Finding => ({ kind: "value", key: "t-age", value: v, describe: (a, b) => `from ${a} to ${b}` });
    await reconcile(db, 143, [value("2100")], at(0), send);
    await reconcile(db, 143, [value("2100")], at(60), send);
    await reconcile(db, 143, [value("2700")], at(120), send);
    expect(sent).toEqual(["CHANGE: from 2100 to 2700"]);
  });

  it("keeps each chain's alert state apart", async () => {
    await reconcile(db, 143, [{ kind: "event", key: "t-chain", message: "on Monad" }], at(0), send);
    await reconcile(db, 8453, [{ kind: "event", key: "t-chain", message: "on Base" }], at(0), send);
    await reconcile(db, 8453, [{ kind: "event", key: "t-chain", message: "on Base" }], at(60), send);
    expect(sent).toEqual(["ALERT: on Monad", "ALERT: on Base"]);
  });

  it("retries a notice whose send failed, and sends an event once", async () => {
    failing = true;
    await reconcile(db, 143, [cond("t-api", true), { kind: "event", key: "t-bad-debt", message: "bad debt" }], at(0), send);
    failing = false;
    await reconcile(db, 143, [cond("t-api", true), { kind: "event", key: "t-bad-debt", message: "bad debt" }], at(60), send);
    await reconcile(db, 143, [cond("t-api", true), { kind: "event", key: "t-bad-debt", message: "bad debt" }], at(120), send);
    expect(sent.sort()).toEqual(["ALERT: bad debt", "ALERT: t-api message"]);
  });

  it("leaves the blocking gates for the API to read, each mapped to its stock or to the whole chain (BE-75)", async () => {
    // X Layer keys in a test database; the fork tests use Monad.
    const chain = 196;
    await db.delete(monitorState).where(and(eq(monitorState.chainId, chain), like(monitorState.key, "gate:%")));
    const gate = (key: string, blocked: boolean | null) => ({ key, blocked, message: `${key} message` });
    const snapshot = { ...healthy(), chainId: chain as 196, gates: [gate("gate:xstock-paused:NVDA", true), gate("gate:xstock-paused:QQQx", true), gate("gate:usdc-blacklist:router", true), gate("gate:xstock-paused:SPY", false), gate("gate:xstock-sanctions:Morpho", null)] };
    await reconcile(db, chain, evaluate(snapshot).filter((f) => f.key.startsWith("gate:")), at(0), send);
    const shown = (key: string) => `${key} message. Opening, closing or liquidating may fail while it lasts.`;
    // `since` is when the block started, in unix seconds: halt alerts key on it.
    const since = Math.floor(at(0).getTime() / 1000);
    expect(await activeGates(db, chain)).toEqual([
      { key: "gate:usdc-blacklist:router", symbol: null, message: shown("gate:usdc-blacklist:router"), since },
      { key: "gate:xstock-paused:NVDA", symbol: "NVDA", message: shown("gate:xstock-paused:NVDA"), since },
      { key: "gate:xstock-paused:QQQx", symbol: "QQQ", message: shown("gate:xstock-paused:QQQx"), since },
    ]);
    // Lifted: nothing left to show.
    snapshot.gates = snapshot.gates.map((g) => ({ ...g, blocked: false }));
    await reconcile(db, chain, evaluate(snapshot).filter((f) => f.key.startsWith("gate:")), at(60), send);
    expect(await activeGates(db, chain)).toEqual([]);
    await db.delete(monitorState).where(and(eq(monitorState.chainId, chain), like(monitorState.key, "gate:%")));
  });

  it("maps every gate key the keeper writes", () => {
    expect(gateSymbol("gate:b20-paused:NVDA")).toBe("NVDA");
    expect(gateSymbol("gate:oracle-paused:GOOGL")).toBe("GOOGL");
    expect(gateSymbol("gate:xstock-paused:SPYx")).toBe("SPY");
    expect(gateSymbol("gate:anchored-denylist:Morpho")).toBeNull();
    expect(gateSymbol("gate:b20-policy:5:router")).toBeNull();
    expect(gateSymbol("gate:usdc-paused")).toBeNull();
  });
});
