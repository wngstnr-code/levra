"use client";

import type { Market } from "@levra/shared/api";
import { gapTable } from "@levra/shared/gaps";
import { liquidationIncentiveFactorWad, WAD } from "@levra/shared/math";
import Link from "next/link";
import { useState } from "react";
import { apiConfigured, useMarketDetail } from "@/lib/api/hooks";
import { cn } from "@/lib/cn";
import { deployedMarket, stockOf } from "@/lib/deployment";
import { formatAge, formatUsdE8 } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { stockTone } from "@/lib/tones";
import { formatBps, formatLeverage, formatToken, formatUsd, formatWadPercent, wadRatio } from "@/lib/units";
import { useNowSeconds } from "@/lib/useNow";
import { useOracleSnapshots } from "@/lib/useOracleSnapshots";
import { AreaChart } from "../ui/AreaChart";
import { ButtonLink } from "../ui/Button";
import { Card } from "../ui/Card";
import { ChangePill } from "../ui/ChangePill";
import { EmptyState } from "../ui/EmptyState";
import { Money } from "../ui/Money";
import { Ring } from "../ui/Ring";
import { SessionBadge } from "../ui/SessionBadge";
import { Skeleton } from "../ui/Skeleton";
import { TokenIcon } from "../ui/TokenIcon";

const DASH = "—";

export function MarketDetailView({ symbol }: { symbol: string }) {
  const m = useT();
  const stock = stockOf(symbol)!;
  const detail = useMarketDetail(symbol);
  const oracle = useOracleSnapshots();
  const now = useNowSeconds();
  const hasShort = deployedMarket(symbol, "short") !== null;
  const [side, setSide] = useState<"long" | "short">("long");
  const market = detail.data?.markets.find((x) => x.side === side) ?? null;
  const snap = oracle.snapshots[symbol];
  const priceE8 = market ? BigInt(market.oraclePriceE8) : (snap?.priceE8 ?? null);
  const session = snap?.session ?? detail.data?.session.session ?? null;
  const gaps = (gapTable as Record<string, { worstDropBps: number; worstRiseBps: number }>)[symbol];

  return (
    <div className="space-y-4">
      <Link href="/markets" className="text-[13px] text-fg-3 hover:text-fg-2">
        {m.detail.breadcrumb} / {stock.tokenSymbol}
      </Link>
      <div className="flex flex-wrap items-end gap-4 pb-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-3.5">
            <TokenIcon symbol={symbol} size={48} />
            <h1 className="text-display text-[40px] leading-tight font-semibold">{stock.tokenSymbol}</h1>
            <span className="text-base text-fg-2">{stock.name}</span>
            {session && <SessionBadge session={session} />}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {priceE8 !== null ? <Money value={formatUsdE8(priceE8)} className="text-display text-[44px] leading-none font-semibold" /> : <Skeleton className="h-11 w-48" />}
            {market?.dexDeviationBps != null && <ChangePill direction={market.dexDeviationBps >= 0 ? "up" : "down"}>{formatBps(market.dexDeviationBps, { signed: true, fractionDigits: 1 })}</ChangePill>}
            {(market?.oracleFeedUpdatedAt ?? snap?.feedUpdatedAt) && <span className="text-sm text-fg-2">{m.markets.quoteAge(formatAge(now - (market?.oracleFeedUpdatedAt ?? snap!.feedUpdatedAt)))}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {hasShort && (
            <ButtonLink href="/earn" variant="secondary">
              {m.detail.lend(stock.tokenSymbol)}
            </ButtonLink>
          )}
          {hasShort && (
            <ButtonLink href={`/trade?symbol=${symbol}&side=short`} className="bg-peach">
              {m.trade.short}
            </ButtonLink>
          )}
          <ButtonLink href={`/trade?symbol=${symbol}&side=long`}>{m.trade.long}</ButtonLink>
        </div>
      </div>

      {hasShort && (
        <div role="tablist" className="inline-flex gap-1 rounded-full bg-surface-1 p-1">
          {(["long", "short"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={side === s} onClick={() => setSide(s)} className={cn("rounded-full px-[18px] py-[9px] text-sm font-medium transition-colors", side === s ? "bg-surface-3 text-fg" : "text-fg-2 hover:text-fg")}>
              {s === "long" ? m.detail.longMarket : m.detail.shortMarket}
            </button>
          ))}
        </div>
      )}

      {!apiConfigured ? (
        <EmptyState glyph="!" title={m.status.offlineTitle} body={m.detail.offline} />
      ) : detail.isPending ? (
        <Skeleton className="h-96 w-full rounded-card" />
      ) : !market ? (
        <EmptyState glyph="!" title={m.common.notAvailable} body={m.detail.offline} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[440px_1fr_1fr]">
            <LimitsCard market={market} symbol={symbol} worstBps={side === "long" ? gaps?.worstDropBps : gaps?.worstRiseBps} />
            <OracleCard market={market} now={now} history={detail.data!.deviationHistory.map((p) => p.deviationBps)} />
            <LendingCard market={market} symbol={symbol} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_520px]">
            <DepthCard depth={detail.data!.depth} now={now} />
            <RateCard market={market} history={detail.data!.rateHistory.filter((r) => r.marketId === market.marketId).map((r) => Number(BigInt(r.borrowApyWad) / 10n ** 12n) / 10_000)} />
          </div>
        </>
      )}
    </div>
  );
}

function Row({ k, v, onPastel }: { k: string; v: string; onPastel?: boolean }) {
  return (
    <p className="flex py-1.5 text-sm">
      <span className={onPastel ? "text-ink/70" : "text-fg-2"}>{k}</span>
      <span className="ml-auto font-semibold tabular-nums">{v}</span>
    </p>
  );
}

function LimitsCard({ market, symbol, worstBps }: { market: Market; symbol: string; worstBps: number | undefined }) {
  const m = useT();
  const bonus = liquidationIncentiveFactorWad(BigInt(market.lltvWad)) - WAD;
  return (
    <Card tone={stockTone(symbol)} className="flex flex-col gap-3">
      <p className="text-xs font-semibold tracking-wide text-ink/60 uppercase">{m.detail.liquidationAt}</p>
      <p className="text-display text-[48px] leading-none font-bold">{m.detail.ltvValue(formatWadPercent(market.lltvWad))}</p>
      <p className="text-sm text-ink/70">{m.detail.bonus(formatWadPercent(bonus))}</p>
      <div className="squircle rounded-panel bg-ink/8 px-4 py-2">
        <Row onPastel k={m.detail.softOpen} v={formatWadPercent(market.softLtvOpenWad)} />
        <Row onPastel k={m.detail.softClosed} v={formatWadPercent(market.softLtvClosedWad)} />
        <Row onPastel k={m.detail.maxLeverage} v={formatLeverage(market.maxLeverageE2)} />
        <Row onPastel k={m.detail.cap} v={formatUsd(market.maxPositionUsdRaw, 0)} />
        {worstBps !== undefined && <Row onPastel k={m.detail.worstGap} v={formatBps(worstBps, { signed: true, fractionDigits: 1 })} />}
      </div>
      <p className="text-[13px] leading-relaxed text-ink/70">{m.detail.limitsExplain(formatWadPercent(market.softLtvOpenWad), formatWadPercent(market.softLtvClosedWad))}</p>
      <p className="mt-auto text-xs text-ink/55">{m.detail.gapSource}</p>
    </Card>
  );
}

function OracleCard({ market, now, history }: { market: Market; now: number; history: number[] }) {
  const m = useT();
  const dev = market.dexDeviationBps;
  return (
    <Card className="flex flex-col gap-4">
      <p className="label-caps">{m.detail.exchangeVsOracle}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("text-display text-[48px] leading-none font-bold", dev === null ? "text-fg-3" : dev < 0 ? "text-down" : "text-up")}>{dev === null ? DASH : formatBps(dev, { signed: true, fractionDigits: 1 })}</span>
        {dev !== null && <span className="text-sm text-fg-2">{dev < 0 ? m.detail.cheaper : m.detail.dearer}</span>}
      </div>
      {history.length > 1 ? <AreaChart values={history} baseline={0} tone={(dev ?? 0) < 0 ? "down" : "up"} label={m.detail.deviationHistory} className="h-28" /> : <p className="text-sm text-fg-3">{m.detail.noHistory}</p>}
      <p className="text-xs text-fg-3">{m.detail.swapLimit}</p>
      <div>
        <Row k={m.detail.oraclePrice} v={formatUsdE8(BigInt(market.oraclePriceE8))} />
        <Row k={m.detail.dexMid} v={market.dexMidPriceE8 ? formatUsdE8(BigInt(market.dexMidPriceE8)) : DASH} />
        <Row k={m.detail.published} v={m.common.ago(formatAge(now - market.oraclePublishedAt))} />
      </div>
    </Card>
  );
}

function LendingCard({ market, symbol }: { market: Market; symbol: string }) {
  const m = useT();
  const stock = stockOf(symbol)!;
  const fmt = (raw: string) => (market.side === "long" ? `${formatUsd(raw, 0)} USDC` : `${formatToken(raw, stock.decimals, 2)} ${stock.tokenSymbol}`);
  return (
    <Card className="flex flex-col gap-4">
      <p className="label-caps">{m.detail.lending}</p>
      <div className="flex items-center gap-5">
        <Ring value={wadRatio(market.utilizationWad, WAD)} size={120} tone="lime" label={`${m.detail.borrowed} ${formatWadPercent(market.utilizationWad)}`}>
          <span className="font-rounded text-2xl font-semibold">{formatWadPercent(market.utilizationWad, 0)}</span>
        </Ring>
        <div className="min-w-0">
          <p className="text-[13px] text-fg-2">{m.detail.borrowed}</p>
          <p className="text-display truncate text-2xl font-semibold">{fmt(market.totalBorrowRaw)}</p>
          <p className="text-[13px] text-fg-2">{m.detail.of(fmt(market.totalSupplyRaw))}</p>
        </div>
      </div>
      <div>
        <Row k={m.detail.borrowApy} v={formatWadPercent(market.borrowApyWad)} />
        <Row k={m.detail.supplyApy} v={formatWadPercent(market.supplyApyWad)} />
        <Row k={m.detail.available} v={fmt(market.availableLiquidityRaw)} />
      </div>
    </Card>
  );
}

function DepthCard({ depth, now }: { depth: { direction: "buy" | "sell"; sizeUsdRaw: string; priceImpactBps: number; deviationBps: number; measuredAt: number }[]; now: number }) {
  const m = useT();
  const sizes = [...new Set(depth.map((d) => d.sizeUsdRaw))].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const at = (size: string, dir: "buy" | "sell") => depth.find((d) => d.sizeUsdRaw === size && d.direction === dir);
  const measured = depth.length ? Math.max(...depth.map((d) => d.measuredAt)) : null;
  const tone = (bps: number) => (bps < 0 ? "text-down" : bps > 0 ? "text-up" : undefined);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center">
        <h2 className="text-xl font-semibold">{m.detail.depth}</h2>
        {measured && <span className="ml-auto text-xs text-fg-3">{m.detail.measured(formatAge(now - measured))}</span>}
      </div>
      {sizes.length === 0 ? (
        <p className="text-sm text-fg-3">{m.detail.noDepth}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[15px]">
            <thead>
              <tr>
                {[m.detail.size, m.detail.buyImpact, m.detail.buyVsOracle, m.detail.sellImpact, m.detail.sellVsOracle].map((h) => (
                  <th key={h} scope="col" className="label-caps px-3 pb-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sizes.map((s) => {
                const b = at(s, "buy");
                const se = at(s, "sell");
                return (
                  <tr key={s} className="border-t border-line">
                    <td className="px-3 py-3 font-semibold">{formatUsd(s, 0)}</td>
                    <td className="px-3 py-3 tabular-nums">{b ? formatBps(b.priceImpactBps) : DASH}</td>
                    <td className={cn("px-3 py-3 tabular-nums", b && tone(b.deviationBps))}>{b ? formatBps(b.deviationBps, { signed: true }) : DASH}</td>
                    <td className="px-3 py-3 tabular-nums">{se ? formatBps(se.priceImpactBps) : DASH}</td>
                    <td className={cn("px-3 py-3 tabular-nums", se && tone(se.deviationBps))}>{se ? formatBps(se.deviationBps, { signed: true }) : DASH}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RateCard({ market, history }: { market: Market; history: number[] }) {
  const m = useT();
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{m.detail.rate}</h2>
      <Money value={formatWadPercent(market.borrowApyWad, 2)} className="text-display text-[36px] leading-none font-semibold" />
      {history.length > 1 ? <AreaChart values={history} tone="lime" label={m.detail.rate} className="h-32 flex-1" /> : <p className="text-sm text-fg-3">{m.detail.noHistory}</p>}
      <p className="text-xs text-fg-3">{m.detail.rateSub}</p>
    </Card>
  );
}
