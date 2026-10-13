import { dexQuotes, marketRates } from "@levra/db";
import { MID_PROBE_USD_RAW, SwapError, dexMidPriceE8, type SwapSource } from "@levra/kyber";
import { external, tokens } from "@levra/shared/addresses";
import { anchoredStockOracleAbi } from "@levra/shared/abis";
import { BPS, signedDeviationBps, stockForUsd, swapPriceE8 } from "@levra/shared/math";
import type { Deployment } from "@levra/shared/deployments";
import { stocks, type Stock } from "@levra/shared/markets";
import { desc, eq } from "drizzle-orm";
import { setTimeout as sleep } from "node:timers/promises";
import type { PublicClient } from "viem";
import type { Job } from "../runner";
import { readRates } from "./rates";

/** Trade sizes for the depth table, in dollars (BE-04). */
export const DEPTH_SIZES_USD = [100, 300, 1_000, 3_000, 10_000] as const;
const USDC = tokens.USDC;

export type DexRow = typeof dexQuotes.$inferInsert;

type Ctx = { swap: SwapSource; pauseMs: number; runId: string; at: Date; calls: { n: number; limited: number } };

async function probe(ctx: Ctx, tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint): Promise<bigint | SwapError> {
  if (ctx.calls.n > 0) await sleep(ctx.pauseMs);
  ctx.calls.n += 1;
  try {
    return await ctx.swap.price({ tokenIn, tokenOut, amountIn });
  } catch (err) {
    if (!(err instanceof SwapError)) throw err;
    if (err.code === "RATE_LIMITED") ctx.calls.limited += 1;
    return err;
  }
}

/**
 * Mid price and, when `full`, buy and sell at every size for one stock. Sizes are in dollars; a sell of `$size` sells
 * the stock worth that much at the oracle price. Impact is against the mid price and positive when worse for the trader.
 */
export async function measureStock(ctx: Ctx, stock: Stock, oraclePriceE8: bigint, full: boolean): Promise<DexRow[]> {
  const base = { runId: ctx.runId, symbol: stock.symbol, oraclePriceE8: oraclePriceE8.toString(), measuredAt: ctx.at };
  const price = (quote: bigint, stockAmount: bigint) => swapPriceE8(quote, stockAmount, USDC.decimals, stock.decimals);

  const midRow = { ...base, kind: "mid", sizeUsdRaw: MID_PROBE_USD_RAW.toString(), amountIn: MID_PROBE_USD_RAW.toString() };
  if (ctx.calls.n > 0) await sleep(ctx.pauseMs);
  ctx.calls.n += 2;
  let mid: bigint;
  try {
    mid = await dexMidPriceE8(ctx.swap, { usdc: USDC.address, stock: stock.token, usdcDecimals: USDC.decimals, stockDecimals: stock.decimals, refPriceE8: oraclePriceE8 });
  } catch (err) {
    if (!(err instanceof SwapError)) throw err;
    if (err.code === "RATE_LIMITED") ctx.calls.limited += 1;
    return [{ ...midRow, error: err.code }];
  }
  const rows: DexRow[] = [{ ...midRow, execPriceE8: mid.toString(), midPriceE8: mid.toString(), deviationBps: signedDeviationBps(mid, oraclePriceE8) }];
  if (!full) return rows;

  for (const size of DEPTH_SIZES_USD) {
    const sizeRaw = BigInt(size) * 10n ** BigInt(USDC.decimals);
    const sides = [
      { kind: "buy", amountIn: sizeRaw, tokenIn: USDC.address, tokenOut: stock.token },
      { kind: "sell", amountIn: stockForUsd(sizeRaw, oraclePriceE8, USDC.decimals, stock.decimals), tokenIn: stock.token, tokenOut: USDC.address },
    ] as const;
    for (const s of sides) {
      const out = await probe(ctx, s.tokenIn, s.tokenOut, s.amountIn);
      const row: DexRow = { ...base, kind: s.kind, sizeUsdRaw: sizeRaw.toString(), amountIn: s.amountIn.toString(), midPriceE8: mid.toString() };
      if (out instanceof SwapError) {
        rows.push({ ...row, error: out.code });
        continue;
      }
      const exec = s.kind === "buy" ? price(s.amountIn, out) : price(out, s.amountIn);
      const worse = s.kind === "buy" ? exec - mid : mid - exec;
      rows.push({
        ...row,
        amountOut: out.toString(),
        execPriceE8: exec.toString(),
        priceImpactBps: Number((worse * BPS) / mid),
        deviationBps: signedDeviationBps(exec, oraclePriceE8),
      });
    }
  }
  return rows;
}

export type MarketDepthOptions = {
  client: PublicClient;
  swap: SwapSource;
  /** How often the mid price is measured. */
  intervalMs?: number;
  /** How often the full depth table is measured. */
  depthEveryMs?: number;
  pauseMs?: number;
  /** With a deployment, each run also stores a rate snapshot of every market (BE-23). */
  deployment?: Deployment | null;
};

/** Measures the DEX mid price of every stock on each run, and the full depth table once a day (BE-04). */
export function createMarketDepth({ client, swap, intervalMs = 600_000, depthEveryMs = 86_400_000, pauseMs = 300, deployment = null }: MarketDepthOptions): Job {
  return {
    name: "marketDepth",
    intervalMs,
    async run({ db, logger }) {
      const at = new Date();
      // Chain reads only, so they go first and do not wait on the aggregator.
      const rates = deployment ? await readRates(client, deployment, at) : [];
      if (rates.length > 0) await db.insert(marketRates).values(rates);
      const [lastFull] = await db.select({ at: dexQuotes.measuredAt }).from(dexQuotes).where(eq(dexQuotes.kind, "buy")).orderBy(desc(dexQuotes.measuredAt)).limit(1);
      const full = !lastFull || at.getTime() - lastFull.at.getTime() >= depthEveryMs;
      const ctx: Ctx = { swap, pauseMs, runId: at.toISOString(), at, calls: { n: 0, limited: 0 } };
      const started = Date.now();
      const rows: DexRow[] = [];

      for (const stock of Object.values(stocks)) {
        const p = await client.readContract({ address: external.anchoredStockOracle, abi: anchoredStockOracleAbi, functionName: "latestPrice", args: [stock.priceId] });
        rows.push(...(await measureStock(ctx, stock, BigInt(p.price), full)));
      }
      await db.insert(dexQuotes).values(rows);

      const failed = rows.filter((r) => r.error).length;
      if (failed > 0) logger.warn({ failed, limited: ctx.calls.limited }, "some DEX quotes failed");
      return { full, rows: rows.length, rates: rates.length, failed, calls: ctx.calls.n, rateLimited: ctx.calls.limited, seconds: Math.round((Date.now() - started) / 1000) };
    },
  };
}
