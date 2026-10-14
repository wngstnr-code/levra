"use client";

import type { Market, PriceRange } from "@levra/shared/api";
import { useState } from "react";
import { apiConfigured, usePriceHistory } from "@/lib/api/hooks";
import { cn } from "@/lib/cn";
import { formatAge, formatUsdE8 } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { formatBps, formatUsd, formatWadPercent } from "@/lib/units";
import { changeBps, chartValues } from "@/lib/priceSeries";
import { useNowSeconds } from "@/lib/useNow";
import { AreaChart } from "../ui/AreaChart";
import { Card } from "../ui/Card";
import { ChangePill } from "../ui/ChangePill";
import { Money } from "../ui/Money";
import { Skeleton } from "../ui/Skeleton";
import { StatBox } from "../ui/StatBox";

const DASH = "—";
const RANGES: PriceRange[] = ["1D", "1W", "1M"];

/** The oracle price of the chosen stock, and the market facts that limit a trade. */
export function PriceCard({
  symbol,
  market,
  priceE8,
  feedUpdatedAt,
  capRaw,
  children,
}: {
  symbol: string;
  market: Market | null;
  priceE8: bigint | null;
  feedUpdatedAt: number | null;
  capRaw: bigint | null;
  children?: React.ReactNode;
}) {
  const m = useT();
  const now = useNowSeconds();
  const [range, setRange] = useState<PriceRange>("1D");
  const history = usePriceHistory(symbol, range);
  const points = history.data?.symbol === symbol ? history.data.points : [];
  const change = changeBps(points);
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="label-caps">{m.trade.oraclePrice}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {priceE8 === null ? <Skeleton className="mt-1 h-11 w-52" /> : <Money value={formatUsdE8(priceE8)} className="text-display block text-[44px] leading-tight font-semibold" />}
            {change !== null && <ChangePill direction={change > 0 ? "up" : change < 0 ? "down" : "flat"}>{formatBps(change, { signed: true })}</ChangePill>}
          </div>
          <p className="mt-1 text-[13px] text-fg-2">{feedUpdatedAt ? m.trade.quoteAge(formatAge(now - feedUpdatedAt)) : DASH}</p>
        </div>
        {apiConfigured && (
          <div role="group" aria-label={m.trade.chartRange} className="flex gap-1 rounded-full bg-surface-2 p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                aria-pressed={range === r}
                onClick={() => setRange(r)}
                className={cn("rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors", range === r ? "bg-surface-3 text-fg" : "text-fg-2 hover:text-fg")}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
      {points.length > 1 ? (
        <AreaChart values={chartValues(points)} tone="peri" label={m.trade.chartLabel(range)} className="h-44" />
      ) : (
        apiConfigured && history.isPending && <Skeleton className="h-44 w-full rounded-panel" />
      )}
      {children}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBox
          label={m.trade.dexMid}
          value={market?.dexMidPriceE8 ? formatUsdE8(BigInt(market.dexMidPriceE8)) : DASH}
          sub={market?.dexDeviationBps != null ? m.trade.vsOracle(formatBps(market.dexDeviationBps, { signed: true, fractionDigits: 1 })) : undefined}
        />
        <StatBox label={m.trade.canBorrow} value={market ? formatUsd(market.availableLiquidityRaw, 0) : DASH} sub="USDC" />
        <StatBox label={m.trade.capLabel} value={capRaw !== null ? formatUsd(capRaw, 0) : DASH} sub={m.trade.perPosition} />
        <StatBox label={m.trade.borrowRate} value={market ? formatWadPercent(market.borrowApyWad) : DASH} sub={m.trade.variable} />
      </div>
    </Card>
  );
}
