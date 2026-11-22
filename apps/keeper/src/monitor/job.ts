import { keeperHeartbeats, latestDepthRun, latestDexMids, monitorState, morphoEvents, morphoPositions, syncCursors, type Db } from "@levra/db";
import { lensAbi, liquidatorAbi, morphoAbi, riskManagerAbi, sessionOracleAbi } from "@levra/shared/abis";
import type { KeeperName } from "@levra/shared/api";
import { chains, type ChainId } from "@levra/shared/chains";
import { isScheduledClosed } from "@levra/shared/calendar";
import type { Deployment } from "@levra/shared/deployments";
import { morphoIsHealthy } from "@levra/shared/math";
import { and, eq, gte } from "drizzle-orm";
import { getAddress, type Address, type PublicClient } from "viem";
import { scheduleForChain, type ScheduleSource } from "../calendar/poster";
import { maxAgeRule } from "../oracle/max-age";
import { readGates } from "./gates";
import { yahooBars, type BarSource } from "../gaps/source";
import { gapStatsFromBars, gapTable, type GapStats } from "@levra/shared/gaps";
import { loadOracleReport } from "../oracle/report";
import { morphoOn } from "../chain";
import type { Job } from "../runner";
import { evaluate, oracleLimit, type Finding, type OracleLimit, type Snapshot } from "./checks";

const SESSIONS = ["UNKNOWN", "PRE_MARKET", "REGULAR", "POST_MARKET", "OVERNIGHT", "CLOSED"];
/** The oracle limits come from a heavy query over weeks of data; once an hour is enough. */
const LIMITS_REFRESH_MS = 3_600_000;
/** Daily prices change once a day; the gap check reads them once a day (BE-34). */
const GAPS_REFRESH_MS = 86_400_000;
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
export async function reconcile(db: Db, chainId: number, findings: Finding[], now: Date, send: (n: Notice) => Promise<void>): Promise<{ sent: number; failed: number }> {
  const rows = new Map((await db.select().from(monitorState).where(eq(monitorState.chainId, chainId))).map((r) => [r.key, r]));
  let sent = 0;
  let failed = 0;
  const put = (key: string, values: Omit<typeof monitorState.$inferInsert, "chainId" | "key" | "updatedAt">) =>
    db
      .insert(monitorState)
      .values({ chainId, key, ...values, updatedAt: now })
      .onConflictDoUpdate({ target: [monitorState.chainId, monitorState.key], set: { ...values, updatedAt: now } });
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
      else if (row.value !== f.value && (await tell(f.key, `CHANGE: ${f.describe(row.value ?? "unset", f.value)}`))) {
        await put(f.key, { active: row.active, since: row.since, notified: row.notified, value: f.value, message: row.message });
      }
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
  /** Keeper wallets to watch for the chain's gas token, by role. */
  wallets: { role: string; address: Address }[];
  /** Public API base address for the response check, for example https://api.levra.xyz. Only in the KEEPER_GLOBAL keeper. */
  apiUrl?: string;
  /** Whether this monitor runs the daily gap check, which covers every chain. Only in the KEEPER_GLOBAL keeper. */
  checkGaps?: boolean;
  schedule?: ScheduleSource;
  /** Daily prices of the real stocks for the gap check (BE-34). */
  bars?: BarSource;
  clock?: () => number;
  intervalMs?: number;
};

/** Team monitoring and alerts (BE-50): every row of "What we monitor" in 08, to the team channels. */
/** Team monitoring and alerts for one chain; the API and gap checks run once, in the KEEPER_GLOBAL keeper. */
export function createMonitor({ client, deployment, channels, wallets, apiUrl, checkGaps = true, schedule = scheduleForChain, bars = yahooBars(), clock = () => Math.floor(Date.now() / 1000), intervalMs = 60_000 }: MonitorOptions): Job {
  const chainId = deployment.chainId as ChainId;
  const morpho = morphoOn(chainId);
  const labels = new Map(deployment.markets.map((m) => [m.marketId.toLowerCase(), `${m.symbol} ${m.side}`]));
  let limitsCache: { at: number; stats: Map<string, { p99: number; n: number }> } | null = null;
  let gapsCache: { at: number; rows: Snapshot["gaps"] } | null = null;

  /** A source that cannot be read leaves `fresh` null, so the check waits instead of alerting. */
  async function gapRows(symbols: string[]): Promise<Snapshot["gaps"]> {
    if (!checkGaps) return [];
    if (gapsCache && Date.now() - gapsCache.at < GAPS_REFRESH_MS) return gapsCache.rows;
    const rows = await Promise.all(
      symbols
        .filter((s) => s in gapTable)
        .map(async (symbol) => {
          const fresh = await bars(symbol).then((b) => gapStatsFromBars(b) as GapStats).catch(() => null);
          return { symbol, table: (gapTable as Record<string, GapStats>)[symbol]!, fresh };
        }),
    );
    if (rows.every((r) => r.fresh)) gapsCache = { at: Date.now(), rows };
    return rows;
  }

  async function sessionStats(db: Db) {
    if (!limitsCache || Date.now() - limitsCache.at > LIMITS_REFRESH_MS) {
      const report = await loadOracleReport(db, chainId);
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
    const borrowers = (await morphoPositions(db, chainId)).filter((p) => p.borrowShares > 0n && labels.has(p.marketId));
    const out: Snapshot["unhealthy"] = [];
    for (const market of deployment.markets) {
      const mine = borrowers.filter((b) => b.marketId === market.marketId.toLowerCase());
      if (mine.length === 0) continue;
      // price() reverts while the oracle is stale; Morpho cannot liquidate then, which the oracle check reports.
      const price = await client.readContract({ address: market.oracle, abi: sessionOracleAbi, functionName: "price" }).catch(() => null);
      if (price === null) continue;
      const m = await client.readContract({ address: morpho, abi: morphoAbi, functionName: "market", args: [market.marketId] });
      const positions = await client.multicall({
        allowFailure: false,
        contracts: mine.map((b) => ({ address: morpho, abi: morphoAbi, functionName: "position", args: [market.marketId, getAddress(b.user)] }) as const),
      });
      positions.forEach((p, i) => {
        const healthy = morphoIsHealthy({ collateral: p.collateral, borrowShares: p.borrowShares }, { totalBorrowAssets: m.totalBorrowAssets, totalBorrowShares: m.totalBorrowShares }, price, BigInt(market.lltv));
        if (!healthy) out.push({ borrower: getAddress(mine[i]!.user), label: labels.get(market.marketId.toLowerCase())! });
      });
    }
    return out;
  }

  /** USDC for the long markets, the stock for the short ones. A liquidator without `lossBudgetOf` (Monad's live one) gives none. */
  async function lossBudgets(): Promise<Snapshot["lossBudgets"]> {
    const liquidator = deployment.liquidator;
    if (!liquidator) return [];
    const loans = [...new Map(deployment.markets.map((m) => [m.loanToken.toLowerCase(), { token: m.loanToken, label: m.side === "long" ? "USDC" : `the ${m.symbol} short market's stock` }])).values()];
    const reads = await client.multicall({
      allowFailure: true,
      contracts: loans.map((l) => ({ address: liquidator, abi: liquidatorAbi, functionName: "lossBudgetOf", args: [l.token] }) as const),
    });
    return loans.flatMap((l, i) => (reads[i]!.status === "success" ? [{ ...l, budget: reads[i]!.result as bigint }] : []));
  }

  async function collect(db: Db): Promise<{ snapshot: Snapshot; limits: Record<string, OracleLimit> }> {
    const now = clock();
    const [views, nextCloseAt, sched, mids, beats, cursors, block, stats, api] = await Promise.all([
      client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getMarkets" }),
      client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "nextCloseAt" }),
      schedule(db, chainId),
      latestDexMids(db, chainId, 1_800),
      db.select().from(keeperHeartbeats).where(eq(keeperHeartbeats.chainId, chainId)),
      db.select().from(syncCursors).where(eq(syncCursors.chainId, chainId)),
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
    const depth = new Map(await Promise.all(symbols.map(async (s) => [s, await latestDepthRun(db, chainId, s)] as const)));
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
    const liquidations = await db.select().from(morphoEvents).where(and(eq(morphoEvents.chainId, chainId), eq(morphoEvents.name, "Liquidate"), gte(morphoEvents.blockTime, lookback)));
    const watchedCursors = ["router_events", "morpho_events", ...(deployment.usdcVault ? ["vault_events"] : [])];

    const snapshot: Snapshot = {
      chainId,
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
      gaps: await gapRows(symbols),
      lossBudgets: await lossBudgets(),
      gates: await readGates(client, chainId, deployment),
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
        await Promise.all(channels.map((c) => c(`[Levra ${chains[chainId].name}] ${n.text}`)));
      };
      const result = await reconcile(db, chainId, findings, new Date(snapshot.now * 1000), send);
      const firing = findings.filter((f) => f.kind === "condition" && f.active).map((f) => f.key);
      if (result.failed > 0) throw new Error(`${result.failed} team alert(s) could not be sent; they will be retried`);
      return { oracleLimits: limits, firing, sent: result.sent };
    },
  };
}
