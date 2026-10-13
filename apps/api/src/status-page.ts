import { KEEPER_HEARTBEAT_LIMIT_S, type KeeperName, type StatusResponse } from "@levra/shared/api";

/**
 * The public status page (BE-61): the same facts as `/v1/status`, as one plain HTML page that refreshes itself. No
 * script, no outside font or stylesheet, so it still loads when other parts of the system are down.
 */

/** About two minutes of Monad blocks, the same limit the team monitor uses (BE-50). */
const INDEXER_LAG_BLOCKS = 300;

const KEEPER_LABELS: Record<KeeperName, string> = {
  liquidator: "Liquidations",
  protector: "Auto-deleverage before the close",
  calendar: "Market close calendar",
  alerts: "User alerts",
  oracleMonitor: "Oracle price log",
  oracleAgePoster: "Oracle age limit",
  marketDepth: "DEX prices and depth",
  transfers: "Cross-chain transfers",
  monitor: "Team monitoring",
};

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function age(seconds: number): string {
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3_600)} h`;
  return `${Math.round(seconds / 86_400)} days`;
}

type Row = { name: string; ok: boolean; detail: string };

/** Keepers that never sent a heartbeat are not running in this deployment, so they are listed as off, not as down. */
export function statusRows(s: StatusResponse, now: number): { oracle: Row[]; keepers: Row[]; indexer: Row; ok: boolean } {
  const oracle = s.oracle.map((o) => ({
    name: o.symbol,
    ok: !o.stale,
    detail: `${o.stale ? "Price too old" : "Price live"}, updated ${age(o.ageSeconds)} ago${o.ageLimitSeconds ? `, limit ${age(o.ageLimitSeconds)}` : ""}`,
  }));
  const keepers = s.keepers
    .filter((k) => k.lastHeartbeatAt !== null)
    .map((k) => ({
      name: KEEPER_LABELS[k.name],
      ok: k.healthy,
      detail: k.healthy ? `Running, last seen ${age(Math.max(0, now - k.lastHeartbeatAt!))} ago` : `Not healthy, last seen ${age(Math.max(0, now - k.lastHeartbeatAt!))} ago (limit ${age(KEEPER_HEARTBEAT_LIMIT_S[k.name])})`,
    }));
  const indexer = {
    name: "Indexer",
    ok: s.indexer.lagBlocks <= INDEXER_LAG_BLOCKS,
    detail: `${s.indexer.lagBlocks} blocks behind the chain (block ${s.indexer.lastBlock})`,
  };
  return { oracle, keepers, indexer, ok: [...oracle, ...keepers, indexer].every((r) => r.ok) };
}

/** When the status itself cannot be read, which most often means the chain endpoint is down. */
export function renderStatusUnavailable(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="30"><title>Levra status</title></head><body style="font: 15px/1.5 system-ui, sans-serif; max-width: 720px; margin: 32px auto; padding: 0 16px"><h1>Levra status</h1><p><strong>The status cannot be read right now.</strong> The service cannot reach the chain. Your positions are held in Morpho and can always be closed there directly. This page refreshes every 30 seconds.</p></body></html>`;
}

export function renderStatusPage(s: StatusResponse, now: number): string {
  const { oracle, keepers, indexer, ok } = statusRows(s, now);
  const list = (title: string, rows: Row[]) =>
    rows.length === 0
      ? ""
      : `<section><h2>${title}</h2><ul>${rows
          .map((r) => `<li><span class="dot ${r.ok ? "ok" : "bad"}" aria-hidden="true"></span><span class="name">${escape(r.name)}</span><span class="detail">${escape(r.detail)}</span></li>`)
          .join("")}</ul></section>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Levra status</title>
<style>
:root { color-scheme: light dark; --bg: #f7f7f5; --card: #ffffff; --fg: #1c1c1a; --muted: #6b6b66; --ok: #1f9d55; --bad: #d64545; --line: #e4e4df; }
@media (prefers-color-scheme: dark) { :root { --bg: #121211; --card: #1c1c1a; --fg: #ededea; --muted: #a0a09a; --line: #2c2c29; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 32px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.summary { font-size: 18px; font-weight: 600; margin: 16px 0 24px; padding: 14px 16px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); }
.summary.ok { color: var(--ok); } .summary.bad { color: var(--bad); }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 24px 0 8px; }
ul { list-style: none; margin: 0; padding: 0; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
li { display: grid; grid-template-columns: 12px minmax(0, 1fr); column-gap: 10px; padding: 12px 16px; border-top: 1px solid var(--line); }
li:first-child { border-top: 0; }
.dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 6px; grid-row: span 2; }
.dot.ok { background: var(--ok); } .dot.bad { background: var(--bad); }
.name { font-weight: 600; } .detail { color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
footer { color: var(--muted); font-size: 13px; margin-top: 24px; }
</style>
</head>
<body>
<main>
<h1>Levra status</h1>
<p class="summary ${ok ? "ok" : "bad"}">${ok ? "All systems normal" : "Some parts need attention"}</p>
${list("Stock prices (Anchored oracle)", oracle)}
${list("Background services", keepers)}
${list("Data", [indexer])}
<footer>Checked at ${new Date(now * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC. API version ${escape(s.api.version)}. Your positions are held in Morpho and can always be closed there directly. This page refreshes every 30 seconds.</footer>
</main>
</body>
</html>`;
}
