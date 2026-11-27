import { stocksByChain, type ChainlinkStock } from "@levra/shared/markets";
import { createPublicClient, http, type PublicClient } from "viem";
import { base, xLayer } from "viem/chains";
import { aggregatorRoundOf, chainFeedReader, phaseOf, type FeedRound } from "../src/oracle/chainlink";

/**
 * The freeze report for the Chainlink stock feeds of Base or X Layer (BE-97, BE-30), from the chain alone: every round
 * of every feed since `--from`, read back from the latest through the proxy, with the last write, the gaps over
 * `--gap-hours` and the rounds per hour. Needs no database, so it runs anywhere with the public RPC (or RPC_URL).
 *
 *   pnpm --filter @levra/keeper feed-rounds --chain 8453 --from 2026-11-27T12:00:00Z [--gap-hours 1]
 */
const viemChains = { 8453: base, 196: xLayer } as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const iso = (s: bigint) => new Date(Number(s) * 1000).toISOString().slice(0, 16).replace("T", " ");

async function roundsSince(reader: ReturnType<typeof chainFeedReader>, feed: ChainlinkStock["priceFeed"], latest: FeedRound, from: bigint): Promise<FeedRound[]> {
  const phase = phaseOf(latest.roundId);
  const found = [latest];
  let next = aggregatorRoundOf(latest.roundId) - 1n;
  while (latest.updatedAt >= from && next >= 1n) {
    const count = next < 100n ? next : 100n;
    const ids = Array.from({ length: Number(count) }, (_, i) => (phase << 64n) | (next - BigInt(i)));
    for (const round of await reader.rounds(feed, ids)) {
      if (!round) throw new Error(`Feed ${feed} has no data below round ${latest.roundId}`);
      if (round.updatedAt < from) return found.reverse();
      found.push(round);
    }
    next -= count;
  }
  return found.reverse();
}

async function main() {
  const chainId = Number(arg("--chain"));
  if (chainId !== 8453 && chainId !== 196) throw new Error("--chain must be 8453 (Base) or 196 (X Layer)");
  const fromMs = Date.parse(arg("--from") ?? "");
  if (!Number.isFinite(fromMs)) throw new Error("--from must be a date, for example 2026-11-27T12:00:00Z");
  const gapHours = Number(arg("--gap-hours") ?? 1);
  const from = BigInt(Math.floor(fromMs / 1000));
  const client = createPublicClient({ chain: viemChains[chainId], transport: http(process.env.RPC_URL || undefined, { retryCount: 5, retryDelay: 1_500 }) }) as PublicClient;
  // X Layer's public endpoint allows fewer calls; smaller batches keep it answering.
  const reader = chainFeedReader(client, chainId === 196 ? 100 : 200);
  const stocks = Object.values(stocksByChain[chainId]) as ChainlinkStock[];
  const latest = await reader.latest(stocks.map((s) => s.priceFeed));
  const readAt = BigInt(Math.floor(Date.now() / 1000));

  console.log(`Chain ${chainId}, rounds since ${iso(from)} UTC, read at ${iso(readAt)} UTC.\n`);
  console.log("| Stock | Rounds | Last write (UTC) | Gaps over " + gapHours + " h |\n|---|---|---|---|");
  const hours: string[] = [];
  for (const [i, stock] of stocks.entries()) {
    const rounds = latest[i]!.updatedAt < from ? [] : await roundsSince(reader, stock.priceFeed, latest[i]!, from);
    const gaps: string[] = [];
    for (let j = 1; j < rounds.length; j++) {
      const gap = rounds[j]!.updatedAt - rounds[j - 1]!.updatedAt;
      if (gap > BigInt(Math.round(gapHours * 3600))) gaps.push(`${iso(rounds[j - 1]!.updatedAt)} to ${iso(rounds[j]!.updatedAt)} (${(Number(gap) / 3600).toFixed(1)} h)`);
    }
    // The time from the last write to the read is a gap too, while the feed is stopped.
    const open = readAt - latest[i]!.updatedAt;
    if (open > BigInt(Math.round(gapHours * 3600))) gaps.push(`${iso(latest[i]!.updatedAt)} to the read (${(Number(open) / 3600).toFixed(1)} h, still open)`);
    console.log(`| ${stock.symbol} | ${rounds.length} | ${iso(latest[i]!.updatedAt)} | ${gaps.join("; ") || "none"} |`);
    const perHour = new Map<string, number>();
    for (const r of rounds) perHour.set(iso(r.updatedAt).slice(5, 13), (perHour.get(iso(r.updatedAt).slice(5, 13)) ?? 0) + 1);
    hours.push(`${stock.symbol}: ${[...perHour].map(([h, n]) => `${h}h ${n}`).join(", ") || "none"}`);
  }
  console.log(`\nRounds per hour (UTC):\n${hours.join("\n")}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
