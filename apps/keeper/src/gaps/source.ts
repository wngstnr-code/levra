import type { DailyBar } from "@levra/shared/gaps";
import { z } from "zod";

/**
 * Daily open and close of the real stocks behind the tokens, the data behind the gap table (BE-34, 04). Yahoo Finance's
 * chart API, the same source as the table; prices are adjusted for splits, so a split is not counted as a gap.
 */
export const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

const chart = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({ gmtoffset: z.number() }),
          timestamp: z.array(z.number()),
          indicators: z.object({ quote: z.array(z.object({ open: z.array(z.number().nullable()), close: z.array(z.number().nullable()) })) }),
        }),
      )
      .nullable(),
    error: z.unknown().nullable(),
  }),
});

export type BarSource = (symbol: string) => Promise<DailyBar[]>;

/** Five years of daily bars, oldest first, dated in the exchange's time zone. Days with a missing open or close are skipped. */
export function yahooBars({ range = "5y", fetchFn = fetch, baseUrl = YAHOO_CHART_URL }: { range?: string; fetchFn?: typeof fetch; baseUrl?: string } = {}): BarSource {
  return async (symbol) => {
    const res = await fetchFn(`${baseUrl}/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, {
      // The service refuses requests without a browser-like user agent.
      headers: { "user-agent": "Mozilla/5.0 (compatible; levra-backend)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Daily prices for ${symbol}: the source answered ${res.status}`);
    const parsed = chart.safeParse(await res.json());
    const result = parsed.success ? parsed.data.chart.result?.[0] : undefined;
    if (!result) throw new Error(`Daily prices for ${symbol}: unknown answer from the source`);
    const quote = result.indicators.quote[0]!;
    const bars: DailyBar[] = [];
    result.timestamp.forEach((t, i) => {
      const open = quote.open[i];
      const close = quote.close[i];
      if (open == null || close == null) return;
      bars.push({ date: new Date((t + result.meta.gmtoffset) * 1000).toISOString().slice(0, 10), open, close });
    });
    return bars;
  };
}
