import { keeperHeartbeats, latestDepthRun, latestDexMids, monitorState, morphoEvents, morphoPositions, syncCursors, type Db } from "@levra/db";
import { external } from "@levra/shared/addresses";
import { lensAbi, morphoAbi, riskManagerAbi, sessionOracleAbi } from "@levra/shared/abis";
import type { KeeperName } from "@levra/shared/api";
import { isScheduledClosed } from "@levra/shared/calendar";
import type { Deployment } from "@levra/shared/deployments";
import { morphoIsHealthy } from "@levra/shared/math";
import { and, eq, gte } from "drizzle-orm";
import { getAddress, type Address, type PublicClient } from "viem";
import { scheduleFromLogger, type ScheduleSource } from "../calendar/poster";
import { maxAgeRule } from "../oracle/max-age";
import { loadOracleReport } from "../oracle/report";
import type { Job } from "../runner";
import { evaluate, oracleLimit, type Finding, type OracleLimit, type Snapshot } from "./checks";

const SESSIONS = ["UNKNOWN", "PRE_MARKET", "REGULAR", "POST_MARKET", "OVERNIGHT", "CLOSED"];
/** The oracle limits come from a heavy query over weeks of data; once an hour is enough. */
const LIMITS_REFRESH_MS = 3_600_000;
const API_TIMEOUT_MS = 10_000;
/** Checks whose subject can disappear (a liquidated borrower); a key missing from a run is resolved. */
const VANISHING_PREFIXES = ["unhealthy:"];

/** Where team alerts go: a Telegram group, a Discord or Slack style webhook, or both. */
export type TeamChannel = (text: string) => Promise<void>;

/** A Discord or Slack incoming webhook: Discord reads `content`, Slack reads `text`. */
export function webhookChannel(url: string): TeamChannel {
  return async (text) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text, text }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Team webhook answered ${res.status}`);
  };
}

export type Notice = { key: string; text: string };

/**
 * Turns findings into notices: a condition alerts once it has lasted `forSeconds` and resolves when it ends, a value
 * alerts on every change after the first, an event alerts once. State is written only after its notice went out, so a
 * failed send is retried next run.
 */
export async function reconcile(db: Db, findings: Finding[], now: Date, send: (n: Notice) => Promise<void>): Promise<{ sent: number; failed: number }> {
  const rows = new Map((await db.select().from(monitorState)).map((r) => [r.key, r]));
  let sent = 0;
  let failed = 0;
  const put = (key: string, values: Omit<typeof monitorState.$inferInsert, "key" | "updatedAt">) =>
    db.insert(monitorState).values({ key, ...values, updatedAt: now }).onConflictDoUpdate({ target: monitorState.key, set: { ...values, updatedAt: now } });
  const tell = async (key: string, text: string) => {
    try {
      await send({ key, text });
      sent += 1;
      return true;
    } catch {
      failed += 1;
      return false;
    }
  };

  const seen = new Set<string>();
  for (const f of findings) {
    seen.add(f.key);
    const row = rows.get(f.key);
    if (f.kind === "value") {
      if (!row) await put(f.key, { active: false, since: null, notified: false, value: f.value, message: null });
      else if (row.value !== f.value && (await tell(f.key, `CHANGE: ${f.describe(row.value ?? "unset", f.value)}`))) await put(f.key, { ...row, value: f.value });
      continue;
    }
    if (f.kind === "event") {
      if (!row && (await tell(f.key, `ALERT: ${f.message}`))) await put(f.key, { active: false, since: now, notified: true, value: null, message: f.message });
      continue;
    }
    if (f.active) {
      const since = row?.active && row.since ? row.since : now;
      const due = now.getTime() - since.getTime() >= f.forSeconds * 1000;
      const notified = row?.active ? row.notified : false;
      if (!notified && due) {
        const ok = await tell(f.key, `ALERT: ${f.message}`);
        await put(f.key, { active: true, since, notified: ok, value: null, message: f.message });
      } else if (!row?.active) {
        await put(f.key, { active: true, since, notified, value: null, message: f.message });
      }
    } else if (row?.active) {
      if (!row.notified || (await tell(f.key, `RESOLVED: ${f.message}`))) await put(f.key, { active: false, since: null, notified: false, value: null, message: f.message });
    }
  }
  for (const row of rows.values()) {
    if (!row.active || seen.has(row.key) || !VANISHING_PREFIXES.some((p) => row.key.startsWith(p))) continue;
    if (!row.notified || (await tell(row.key, `RESOLVED: ${row.message ?? row.key} It is gone now.`))) await put(row.key, { active: false, since: null, notified: false, value: null, message: row.message });
  }
  return { sent, failed };
}

export type MonitorOptions = {
  client: PublicClient;
  deployment: Deployment;
  channels: TeamChannel[];
  /** Keeper wallets to watch for MON, by role. */
  wallets: { role: string; address: Address }[];
  /** Public API base address for the response check, for example https://api.levra.xyz. */
  apiUrl?: string;
  schedule?: ScheduleSource;
  clock?: () => number;
  intervalMs?: number;
};

/** Team monitoring and alerts (BE-50): every row of "What we monitor" in 08, to the team channels. */
export function createMonitor({ client, deployment, channels, wallets, apiUrl, schedule = scheduleFromLogger, clock = () => Math.floor(Date.now() / 1000), intervalMs = 60_000 }: MonitorOptions): Job {
  const labels = new Map(deployment.markets.map((m) => [m.marketId.toLowerCase(), `${m.symbol} ${m.side}`]));
  let limitsCache: { at: number; stats: Map<string, { p99: number; n: number }> } | null = null;

  async function sessionStats(db: Db) {
    if (!limitsCache || Date.now() - limitsCache.at > LIMITS_REFRESH_MS) {
      const report = await loadOracleReport(db);
      limitsCache = { at: Date.now(), stats: new Map(report.sourceAge.map((s) => [`${s.symbol}:${s.session}`, { p99: s.p99, n: s.n }])) };
    }
    return limitsCache.stats;
  }

  async function probeApi(): Promise<Snapshot["api"]> {
    if (!apiUrl) return null;
    const started = Date.now();
    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/markets`, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
      return { ok: res.ok, ms: Date.now() - started, detail: `status ${res.status}` };
    } catch (err) {
      return { ok: false, ms: Date.now() - started, detail: (err as Error).message };
    }
  }

  async function unhealthyBorrowers(db: Db): Promise<Snapshot["unhealthy"]> {
    const borrowers = (await morphoPositions(db)).filter((p) => p.borrowShares > 0n && labels.has(p.marketId));
    const out: Snapshot["unhealthy"] = [];
    for (const market of deployment.markets) {
      const mine = borrowers.filter((b) => b.marketId === market.marketId.toLowerCase());
      if (mine.length === 0) continue;
      // price() reverts while the oracle is stale; Morpho cannot liquidate then, which the oracle check reports.
      const price = await client.readContract({ address: market.oracle, abi: sessionOracleAbi, functionName: "price" }).catch(() => null);
      if (price === null) continue;
      const m = await client.readContract({ address: external.morpho, abi: morphoAbi, functionName: "market", args: [market.marketId] });
      const positions = await client.multicall({
        allowFailure: false,
        contracts: mine.map((b) => ({ address: external.morpho, abi: morphoAbi, functionName: "position", args: [market.marketId, getAddress(b.user)] }) as const),
      });
      positions.forEach((p, i) => {
        const healthy = morphoIsHealthy({ collateral: p.collateral, borrowShares: p.borrowShares }, { totalBorrowAssets: m.totalBorrowAssets, totalBorrowShares: m.totalBorrowShares }, price, BigInt(market.lltv));
        if (!healthy) out.push({ borrower: getAddress(mine[i]!.user), label: labels.get(market.marketId.toLowerCase())! });
      });
    }
    return out;
  }

  async function collect(db: Db): Promise<{ snapshot: Snapshot; limits: Record<string, OracleLimit> }> {
    const now = clock();
    const [views, nextCloseAt, sched, mids, beats, cursors, block, stats, api] = await Promise.all([
      client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getMarkets" }),
      client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "nextCloseAt" }),
      schedule(db),
      latestDexMids(db, 1_800),
      db.select().from(keeperHeartbeats),
      db.select().from(syncCursors),
      client.getBlock({ blockTag: "latest" }),
      sessionStats(db),
      probeApi(),
    ]);
    const configs = await client.multicall({
      allowFailure: false,
      contracts: views.map((v) => ({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [v.marketId] }) as const),
    });

    const ours = views.map((v, i) => ({ v, c: configs[i]!, info: deployment.markets.find((m) => m.marketId.toLowerCase() === v.marketId.toLowerCase()) })).filter((x) => x.info);
    const symbols = [...new Set(ours.map((x) => x.info!.symbol))];
    const depth = new Map(await Promise.all(symbols.map(async (s) => [s, await latestDepthRun(db, s)] as const)));
    const limits: Record<string, OracleLimit> = {};
    const stocks: Snapshot["stocks"] = symbols.map((symbol) => {
      const mine = ours.filter((x) => x.info!.symbol === symbol);
      const first = mine[0]!.v;
      const session = SESSIONS[first.session] ?? "UNKNOWN";
      // The strict default is the open check on chain: the shortest maxOracleAge among the stock's markets.
      const strict = Math.min(...mine.map((x) => x.c.maxOracleAge));
      const limit = oracleLimit(stats.get(`${symbol}:${session}`), strict, maxAgeRule);
      limits[symbol] = limit;
      return {
        symbol,
        session,
        feedUpdatedAt: Number(first.feedUpdatedAt),
        priceE8: first.priceE8,
        dexMidE8: mids.get(symbol) ?? null,
        maxDeviationBps: Math.min(...mine.map((x) => x.c.maxDeviationBps)),
        limit,
      };
    });

    const lookback = new Date((now - 86_400) * 1000);
    const liquidations = await db.select().from(morphoEvents).where(and(eq(morphoEvents.name, "Liquidate"), gte(morphoEvents.blockTime, lookback)));
    const watchedCursors = ["router_events", "morpho_events", ...(deployment.usdcVault ? ["vault_events"] : [])];

    const snapshot: Snapshot = {
      now,
      scheduleClosed: isScheduledClosed(now, sched),
      scheduleObserved: sched.source === "observed",
      stocks,
      markets: ours.map(({ v, c, info }) => ({
        marketId: v.marketId.toLowerCase(),
        label: `${info!.symbol} ${info!.side}`,
        side: info!.side,
        lltvWad: v.lltv,
        maxOracleAge: c.maxOracleAge,
        maxPositionUsdRaw: v.maxPositionUsd,
        totalSupplyRaw: v.totalSupplyAssets,
        totalBorrowRaw: v.totalBorrowAssets,
        depth: (depth.get(info!.symbol) ?? []).map((d) => ({ direction: d.direction, sizeUsdRaw: BigInt(d.sizeUsdRaw), deviationBps: d.deviationBps, measuredAt: d.measuredAt })),
      })),
      nextCloseAt: Number(nextCloseAt),
      heartbeats: beats.map((b) => ({ name: b.name as KeeperName, lastBeatAt: Math.floor(b.lastBeatAt.getTime() / 1000), lastError: b.lastError })),
      wallets: await Promise.all(wallets.map(async (w) => ({ role: w.role, address: w.address, balanceWei: await client.getBalance({ address: w.address }) }))),
      unhealthy: await unhealthyBorrowers(db),
      badDebt: liquidations
        .filter((e) => BigInt(String(e.args.badDebtAssets ?? "0")) > 0n)
        .map((e) => ({ txHash: e.txHash, logIndex: e.logIndex, label: labels.get(e.marketId) ?? e.marketId, borrower: e.user, badDebtAssets: BigInt(String(e.args.badDebtAssets)), at: Math.floor(e.blockTime.getTime() / 1000) })),
      indexer: cursors.filter((c) => watchedCursors.includes(c.name)).map((c) => ({ cursor: c.name, lastBlock: c.lastBlock })),
      head: block.number,
      api,
    };
    return { snapshot, limits };
  }

  return {
    name: "monitor",
    intervalMs,
    async run({ db, logger }) {
      const { snapshot, limits } = await collect(db);
      const findings = evaluate(snapshot);
      const send = async (n: Notice) => {
        logger.warn({ key: n.key }, n.text);
        if (channels.length === 0) return;
        await Promise.all(channels.map((c) => c(`[Levra] ${n.text}`)));
      };
      const result = await reconcile(db, findings, new Date(snapshot.now * 1000), send);
      const firing = findings.filter((f) => f.kind === "condition" && f.active).map((f) => f.key);
      if (result.failed > 0) throw new Error(`${result.failed} team alert(s) could not be sent; they will be retried`);
      return { oracleLimits: limits, firing, sent: result.sent };
    },
  };
}
