import type { Db } from "@levra/db";
import { sql } from "drizzle-orm";
import { proposeMaxOracleAge, type MaxAgeProposal } from "./max-age";

type Coverage = { symbol: string; n: number; first: Date; last: Date };
type Spread = { symbol: string; session: string; n: number; p50: number; p95: number; p99: number; max: number };
type Transition = { symbol: string; prev: string; session: string; at: Date };
type BidAsk = {
  symbol: string;
  n: number;
  bidZero: number;
  askZero: number;
  crossed: number;
  bidAbovePrice: number;
  askBelowPrice: number;
  p99SpreadBps: number;
  maxSpreadBps: number;
};
type ClosedStretch = { symbol: string; from: Date; to: Date; hours: number };

export type OracleReport = {
  generatedAt: Date;
  coverage: Coverage[];
  publishIntervals: Spread[];
  sourceAge: Spread[];
  transitions: Transition[];
  closedStretches: ClosedStretch[];
  bidAsk: BidAsk[];
  maxAge: { symbol: string; proposal: MaxAgeProposal }[];
};

/** Fully observed `CLOSED` stretch at least this long counts as a weekend. */
const WEEKEND_MIN_HOURS = 40;
const OPEN = "ALL_OPEN";

async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

const percentiles = (col: string) =>
  sql.raw(`count(*)::int as n,
    percentile_cont(0.5) within group (order by ${col})::float as p50,
    percentile_cont(0.95) within group (order by ${col})::float as p95,
    percentile_cont(0.99) within group (order by ${col})::float as p99,
    max(${col})::float as max`);

export async function loadOracleReport(db: Db): Promise<OracleReport> {
  const coverage = await rows<Coverage>(
    db,
    sql`select symbol, count(*)::int as n, min(block_time) as first, max(block_time) as last
        from oracle_updates group by symbol order by symbol`,
  );

  const publishIntervals = await rows<Spread>(
    db,
    sql`select symbol, session, ${percentiles("gap")}
        from (select symbol, session,
                extract(epoch from published_at - lag(published_at) over (partition by symbol order by block_number, log_index)) as gap
              from oracle_updates) x
        where gap is not null group by symbol, session order by symbol, session`,
  );

  const sourceAge = await rows<Spread>(
    db,
    sql`with bounds as (select symbol, min(block_time) as lo, max(block_time) as hi from oracle_updates group by symbol),
        grid as (
          select b.symbol, g as t from bounds b,
          generate_series(date_trunc('minute', b.lo) + interval '1 minute', b.hi, interval '1 minute') g
        ),
        s as (
          select grid.symbol, u.session, extract(epoch from grid.t - u.feed_updated_at) as age
          from grid cross join lateral (
            select session, feed_updated_at from oracle_updates o
            where o.symbol = grid.symbol and o.block_time <= grid.t
            order by o.block_time desc limit 1
          ) u
        )
        select symbol, session, ${percentiles("age")} from s group by symbol, session
        union all
        select symbol, ${sql.raw(`'${OPEN}'`)} as session, ${percentiles("age")} from s where session <> 'CLOSED' group by symbol
        order by symbol, session`,
  );

  const transitions = await rows<Transition>(
    db,
    sql`select symbol, prev, session, at from (
          select symbol, session, block_time as at,
            lag(session) over (partition by symbol order by block_number, log_index) as prev
          from oracle_updates) x
        where prev is not null and prev <> session order by at`,
  );

  const bidAsk = await rows<BidAsk>(
    db,
    sql`select symbol, count(*)::int as n,
          count(*) filter (where best_bid_e8 <= 0)::int as "bidZero",
          count(*) filter (where best_ask_e8 <= 0)::int as "askZero",
          count(*) filter (where best_bid_e8 > best_ask_e8)::int as crossed,
          count(*) filter (where best_bid_e8 > price_e8)::int as "bidAbovePrice",
          count(*) filter (where best_ask_e8 < price_e8)::int as "askBelowPrice",
          percentile_cont(0.99) within group (order by (best_ask_e8 - best_bid_e8) * 10000 / nullif(price_e8, 0))::float as "p99SpreadBps",
          max((best_ask_e8 - best_bid_e8) * 10000 / nullif(price_e8, 0))::float as "maxSpreadBps"
        from oracle_updates group by symbol order by symbol`,
  );

  const closedStretches = findClosedStretches(transitions);

  const maxAge = coverage.map(({ symbol, first, last }) => {
    const open = sourceAge.find((s) => s.symbol === symbol && s.session === OPEN);
    return {
      symbol,
      proposal: proposeMaxOracleAge({
        p99AgeSeconds: open?.p99 ?? 0,
        samples: open?.n ?? 0,
        spanSeconds: (new Date(last).getTime() - new Date(first).getTime()) / 1000,
        fullWeekends: closedStretches.filter((c) => c.symbol === symbol && c.hours >= WEEKEND_MIN_HOURS).length,
      }),
    };
  });

  return { generatedAt: new Date(), coverage, publishIntervals, sourceAge, transitions, closedStretches, bidAsk, maxAge };
}

/** A stretch is fully observed when both the move into `CLOSED` and the move out of it are in the data. */
export function findClosedStretches(transitions: Transition[]): ClosedStretch[] {
  const open = new Map<string, Date>();
  const stretches: ClosedStretch[] = [];
  for (const t of transitions) {
    if (t.session === "CLOSED") open.set(t.symbol, new Date(t.at));
    else if (t.prev === "CLOSED") {
      const from = open.get(t.symbol);
      if (from) stretches.push({ symbol: t.symbol, from, to: new Date(t.at), hours: (new Date(t.at).getTime() - from.getTime()) / 3_600_000 });
      open.delete(t.symbol);
    }
  }
  return stretches;
}

const et = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const etClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const fmt = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? "-" : n.toFixed(digits));
const minutes = (s: number) => fmt(s / 60, 1);

function table(head: string[], body: (string | number)[][]): string {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

export function renderOracleReport(r: OracleReport): string {
  const transitionGroups = new Map<string, { first: string; last: string; n: number }>();
  for (const t of r.transitions) {
    const [weekday = "", clock = ""] = etClock.format(new Date(t.at)).split(" ");
    const key = `${t.prev} → ${t.session}|${weekday}`;
    const group = transitionGroups.get(key);
    if (!group) transitionGroups.set(key, { first: clock, last: clock, n: 1 });
    else {
      group.first = clock < group.first ? clock : group.first;
      group.last = clock > group.last ? clock : group.last;
      group.n += 1;
    }
  }
  const longClosed = r.closedStretches.filter((c) => c.hours >= 1);

  return [
    `# Anchored oracle report`,
    ``,
    `Generated ${r.generatedAt.toISOString()} from \`oracle_updates\` by \`pnpm --filter @levra/keeper report:oracle\`. Times in US Eastern Time.`,
    ``,
    `## Coverage`,
    table(
      ["Stock", "Updates", "First", "Last", "Days"],
      r.coverage.map((c) => [c.symbol, c.n, et.format(new Date(c.first)), et.format(new Date(c.last)), fmt((new Date(c.last).getTime() - new Date(c.first).getTime()) / 86_400_000, 1)]),
    ),
    ``,
    `## Time between writes (publishedAt), minutes`,
    table(
      ["Stock", "Session", "Writes", "p50", "p95", "p99", "Max"],
      r.publishIntervals.map((s) => [s.symbol, s.session, s.n, minutes(s.p50), minutes(s.p95), minutes(s.p99), minutes(s.max)]),
    ),
    ``,
    `## Source quote age (block time minus feedUpdateTimestamp), sampled every minute, minutes`,
    `\`${OPEN}\` is every session except \`CLOSED\`, the clock \`RiskManager\` checks (D-23).`,
    ``,
    table(
      ["Stock", "Session", "Samples", "p50", "p95", "p99", "Max"],
      r.sourceAge.map((s) => [s.symbol, s.session, s.n, minutes(s.p50), minutes(s.p95), minutes(s.p99), minutes(s.max)]),
    ),
    ``,
    `## Session changes`,
    `Time of the first write in the new session, all stocks together. The real boundary can be up to one write interval earlier. A count above the number of weeks times three stocks means the session went back and forth.`,
    ``,
    table(
      ["Change", "Weekday", "Earliest", "Latest", "Count"],
      [...transitionGroups].map(([key, g]) => {
        const [change = "", weekday = ""] = key.split("|");
        return [change, weekday, g.first, g.last, g.n];
      }),
    ),
    ``,
    `## Fully observed CLOSED stretches of one hour or more`,
    `${r.closedStretches.length - longClosed.length} shorter stretches are left out.`,
    ``,
    table(
      ["Stock", "From", "To", "Hours"],
      longClosed.map((c) => [c.symbol, et.format(c.from), et.format(c.to), fmt(c.hours, 1)]),
    ),
    ``,
    `## Best bid and best ask`,
    table(
      ["Stock", "Writes", "Bid ≤ 0", "Ask ≤ 0", "Bid > ask", "Bid > price", "Ask < price", "p99 spread bps", "Max spread bps"],
      r.bidAsk.map((b) => [b.symbol, b.n, b.bidZero, b.askZero, b.crossed, b.bidAbovePrice, b.askBelowPrice, fmt(b.p99SpreadBps, 1), fmt(b.maxSpreadBps, 1)]),
    ),
    ``,
    `## maxOracleAge from the rule in 04 (initial proposal)`,
    table(
      ["Stock", "Value", "Note"],
      r.maxAge.map(({ symbol, proposal }) => [symbol, proposal.value === null ? "-" : `${proposal.value} s (${proposal.value / 60} min)`, proposal.reason ?? "rule met"]),
    ),
    ``,
  ].join("\n");
}
