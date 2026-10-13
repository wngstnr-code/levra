import { GAP_TABLE_SOURCE, gapStatsFromBars, gapTable, type GapStats } from "@levra/shared/gaps";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { yahooBars } from "./source";

/**
 * Rebuilds the gap table (04, `packages/shared/gaps.ts`) from five years of daily prices (BE-34). Prints the new rows
 * next to the current ones and the rows for the table in 04. With `--write`, replaces the table in gaps.ts.
 * Usage: pnpm --filter @levra/keeper report:gaps [--write]
 */
const source = yahooBars();
const symbols = Object.keys(gapTable) as (keyof typeof gapTable)[];
const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

const rows: { symbol: string; stats: GapStats & { events: number }; from: string; to: string }[] = [];
for (const symbol of symbols) {
  const bars = await source(symbol);
  rows.push({ symbol, stats: gapStatsFromBars(bars), from: bars[0]!.date, to: bars.at(-1)!.date });
}

console.log("| Stock | Events | Gaps over 2% | Worst drop | Worst rise | Was |");
console.log("|---|---|---|---|---|---|");
for (const { symbol, stats } of rows) {
  const old = gapTable[symbol as keyof typeof gapTable];
  const changed = old.worstDropBps !== stats.worstDropBps || old.worstRiseBps !== stats.worstRiseBps || old.over2PctShareBps !== stats.over2PctShareBps;
  console.log(`| ${symbol} | ${stats.events} | ${pct(stats.over2PctShareBps)} | ${pct(stats.worstDropBps)} | +${pct(stats.worstRiseBps)} | ${changed ? `${pct(old.over2PctShareBps)}, ${pct(old.worstDropBps)}, +${pct(old.worstRiseBps)}` : "same"} |`);
}
const from = rows.map((r) => r.from).sort()[0]!.slice(0, 7);
const to = rows.map((r) => r.to).sort().at(-1)!.slice(0, 7);
const events = Math.min(...rows.map((r) => r.stats.events));
console.log(`\nPrevious table: ${GAP_TABLE_SOURCE.from} to ${GAP_TABLE_SOURCE.to}, ${GAP_TABLE_SOURCE.eventsPerStock} events per stock. New: ${from} to ${to}, at least ${events} events per stock.`);

if (process.argv.includes("--write")) {
  const file = fileURLToPath(new URL("../../../../packages/shared/gaps.ts", import.meta.url));
  const text = await readFile(file, "utf8");
  const table = `export const gapTable = {\n${rows
    .map(({ symbol, stats: s }) => `  ${symbol}: { over2PctShareBps: ${s.over2PctShareBps}, worstDropBps: ${s.worstDropBps}, worstRiseBps: ${s.worstRiseBps} },`)
    .join("\n")}\n} as const satisfies Record<string, GapStats>;`;
  const sourceBlock = `export const GAP_TABLE_SOURCE = {\n  from: "${from}",\n  to: "${to}",\n  eventsPerStock: ${events},\n  source: "Yahoo Finance daily close and open",\n} as const;`;
  const next = text
    .replace(/export const gapTable = \{[\s\S]*?\} as const satisfies Record<string, GapStats>;/, table)
    .replace(/export const GAP_TABLE_SOURCE = \{[\s\S]*?\} as const;/, sourceBlock);
  if (next === text) console.log("\ngaps.ts already holds these numbers.");
  else {
    await writeFile(file, next);
    console.log("\nWrote packages/shared/gaps.ts. Update the table in docs/04-risk-rules.md and the check against the soft limits there.");
  }
}
