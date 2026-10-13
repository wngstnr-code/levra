import { createDb, dexQuotes } from "@levra/db";
import { createKyber, KYBER_MONAD_URL } from "@levra/kyber";
import { desc, eq } from "drizzle-orm";
import pino from "pino";
import { createPublicClient, http } from "viem";
import { monad } from "viem/chains";
import { DEPTH_SIZES_USD, createMarketDepth } from "./depth";

/**
 * Prints the latest full depth run as a markdown table. With `--measure`, runs a full measurement first.
 * Usage: pnpm --filter @levra/keeper report:depth [--measure]
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, close } = createDb(url, { max: 1 });

try {
  if (process.argv.includes("--measure")) {
    const rpc = process.env.MONAD_RPC_URL;
    if (!rpc) throw new Error("MONAD_RPC_URL is not set");
    const job = createMarketDepth({
      client: createPublicClient({ chain: monad, transport: http(rpc) }),
      swap: createKyber({ baseUrl: process.env.KYBER_BASE_URL || KYBER_MONAD_URL, clientId: process.env.KYBER_CLIENT_ID || "levra" }),
      depthEveryMs: 0,
    });
    console.error(JSON.stringify(await job.run({ db, logger: pino({ level: "warn" }), signal: new AbortController().signal })));
  }

  const [last] = await db.select({ runId: dexQuotes.runId }).from(dexQuotes).where(eq(dexQuotes.kind, "buy")).orderBy(desc(dexQuotes.measuredAt)).limit(1);
  if (!last) throw new Error("No full depth run yet. Run with --measure.");
  const rows = await db.select().from(dexQuotes).where(eq(dexQuotes.runId, last.runId));

  const pct = (bps: number | null, error: string | null) => (error ? error : bps === null ? "-" : `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(1)}%`);
  const usd = (e8: string | null) => (e8 ? `$${(Number(e8) / 1e8).toFixed(2)}` : "-");
  const head = ["Stock", "Oracle", "DEX mid", "Mid vs oracle", ...DEPTH_SIZES_USD.flatMap((s) => [`Buy $${s.toLocaleString("en-US")}`, `Sell $${s.toLocaleString("en-US")}`])];
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const symbol of [...new Set(rows.map((r) => r.symbol))]) {
    const of = (kind: string, size?: number) =>
      rows.find((r) => r.symbol === symbol && r.kind === kind && (size === undefined || r.sizeUsdRaw === String(BigInt(size) * 1_000_000n)));
    const mid = of("mid");
    const cells = DEPTH_SIZES_USD.flatMap((s) => [of("buy", s), of("sell", s)].map((r) => pct(r?.priceImpactBps ?? null, r?.error ?? null)));
    lines.push(`| a${symbol} | ${usd(mid?.oraclePriceE8 ?? null)} | ${usd(mid?.midPriceE8 ?? null)} | ${pct(mid?.deviationBps ?? null, mid?.error ?? null)} | ${cells.join(" | ")} |`);
  }
  console.log(`Run ${last.runId}. Price impact against the DEX mid price; positive is worse for the trader.\n`);
  console.log(lines.join("\n"));
} finally {
  await close();
}
