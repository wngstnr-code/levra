"use client";

import Link from "next/link";
import { useApiSession, useMarkets, apiConfigured } from "@/lib/api/hooks";
import { cn } from "@/lib/cn";
import { formatAge, formatUsdE8 } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { buildMarketRows, type MarketRow } from "@/lib/marketRows";
import { formatEastern } from "@/lib/time";
import { stockTone } from "@/lib/tones";
import { formatBps, formatLeverage, formatUsd, formatWadPercent } from "@/lib/units";
import { useNowSeconds } from "@/lib/useNow";
import { useOracleSnapshots } from "@/lib/useOracleSnapshots";
import { Button, ButtonLink } from "../ui/Button";
import { Card } from "../ui/Card";
import { ChangePill } from "../ui/ChangePill";
import { InfoLink } from "../ui/InfoLink";
import { Money } from "../ui/Money";
import { SessionBadge } from "../ui/SessionBadge";
import { Skeleton } from "../ui/Skeleton";
import { StatBox } from "../ui/StatBox";
import { TokenIcon } from "../ui/TokenIcon";

const DASH = "—";

export function MarketsView() {
  const m = useT();
  const markets = useMarkets();
  const session = useApiSession();
  const oracle = useOracleSnapshots();
  const now = useNowSeconds();
  const rows = buildMarketRows(markets.data?.markets, oracle.snapshots);
  const loading = (apiConfigured ? markets.isPending : false) && oracle.isPending;
  const nothing = rows.every((r) => r.priceE8 === null);
  const next = markets.data?.session ?? session.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 pt-2 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-display text-[40px] leading-tight font-semibold">{m.markets.title}</h1>
          <p className="mt-2 text-[15px] text-fg-2">{m.markets.subtitle}</p>
        </div>
        {next?.nextCloseAt && <p className="text-right text-[13px] text-fg-2">{m.markets.nextClose(formatEastern(next.nextCloseAt))}</p>}
      </div>

      {!loading && nothing && oracle.isError ? (
        <Card className="flex items-center gap-4">
          <p className="flex-1 text-[15px] text-fg-2">{m.markets.readError}</p>
          <Button variant="secondary" onClick={() => oracle.refetch()} disabled={oracle.isFetching}>
            {oracle.isFetching ? m.common.retrying : m.common.tryAgain}
          </Button>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {rows.map((row) => (loading || row.priceE8 === null ? <CardSkeleton key={row.stock.symbol} /> : <MarketCard key={row.stock.symbol} row={row} now={now} />))}
          </div>
          <MarketsTable rows={rows} now={now} loading={loading} />
        </>
      )}

      <div className="grid gap-4 px-1 pt-2 text-[13px] leading-relaxed text-fg-3 md:grid-cols-3">
        <p>
          {m.markets.legendSoft}
          <InfoLink term="soft-limit" label={m.markets.softLimit} />
        </p>
        <p>
          {m.markets.legendHard}
          <InfoLink term="hard-limit" label={m.markets.legendHard} />
        </p>
        <p>
          {m.markets.legendCap}
          <InfoLink term="position-cap" label={m.markets.cap} />
        </p>
      </div>
    </div>
  );
}

function deviationPill(bps: number | null) {
  if (bps === null) return null;
  return <ChangePill direction={bps > 0 ? "up" : bps < 0 ? "down" : "flat"}>{formatBps(bps, { signed: true, fractionDigits: 1 })}</ChangePill>;
}

function MarketCard({ row, now }: { row: MarketRow; now: number }) {
  const m = useT();
  const { stock, long } = row;
  return (
    <Card tone={stockTone(stock.symbol)} className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <TokenIcon symbol={stock.symbol} inverted />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold">{stock.tokenSymbol}</p>
          <p className="truncate text-[13px] text-ink/60">{stock.name}</p>
        </div>
        {row.deviationBps !== null && (
          <span className="rounded-full bg-ink/10 px-2.5 py-1 text-[13px] font-semibold tabular-nums" title={m.markets.dexVsOracle}>
            {formatBps(row.deviationBps, { signed: true, fractionDigits: 1 })}
          </span>
        )}
      </div>
      <div className="mt-auto">
        <Money value={formatUsdE8(row.priceE8!)} className="text-display block text-[40px] leading-none font-semibold" decimalsClassName="text-ink/40" />
        <p className="mt-2 text-[13px] text-ink/60">
          {row.stale ? m.markets.stale : row.feedUpdatedAt ? m.markets.quoteAge(formatAge(now - row.feedUpdatedAt)) : DASH}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatBox onPastel label={m.markets.maxLong} value={long ? formatLeverage(long.maxLeverageE2) : DASH} />
        <StatBox onPastel label={m.markets.softLimit} value={long ? formatWadPercent(long.currentSoftLtvWad) : DASH} />
      </div>
    </Card>
  );
}

function CardSkeleton() {
  return (
    <Card className="flex h-[312px] flex-col gap-5">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="mt-auto h-10 w-48" />
      <Skeleton className="h-14 w-full rounded-panel" />
    </Card>
  );
}

function MarketsTable({ rows, now, loading }: { rows: MarketRow[]; now: number; loading: boolean }) {
  const m = useT();
  const head = [m.markets.stock, m.markets.oraclePrice, m.markets.session, m.markets.dexVsOracle, m.markets.softHard, m.markets.maxLeverage, m.markets.borrowApy, m.markets.canBorrow, m.markets.cap];
  return (
    <div className="squircle relative overflow-x-auto rounded-card bg-surface-1 py-3">
      <table className="w-full min-w-[1080px] text-left">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="label-caps px-4 py-3 first:pl-7">
                {h}
              </th>
            ))}
            <th scope="col" className="px-7 py-3">
              <span className="sr-only">{m.markets.trade}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { stock, long, short } = row;
            const paused = long ? !long.enabled : false;
            return (
              <tr key={stock.symbol} className="border-t border-line">
                <td className="py-[18px] pr-4 pl-7">
                  <Link href={`/markets/${stock.symbol}`} className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-lime">
                    <TokenIcon symbol={stock.symbol} size={36} />
                    <span>
                      <span className="block text-[15px] font-semibold">{stock.tokenSymbol}</span>
                      <span className="block text-[13px] text-fg-2">{stock.name}</span>
                    </span>
                  </Link>
                </td>
                <Cell main={row.priceE8 !== null ? formatUsdE8(row.priceE8) : loading ? null : DASH} sub={row.stale ? m.markets.stale : row.feedUpdatedAt ? m.common.ago(formatAge(now - row.feedUpdatedAt)) : undefined} subTone={row.stale ? "text-caution" : undefined} />
                <td className="px-4">{row.session ? <SessionBadge session={row.session} /> : <Skeleton className="h-7 w-24" />}</td>
                <td className="px-4">{deviationPill(row.deviationBps) ?? <span className="text-fg-3">{DASH}</span>}</td>
                <Cell main={long ? `${formatWadPercent(long.currentSoftLtvWad)} · ${formatWadPercent(long.lltvWad)}` : DASH} />
                <Cell main={long ? m.markets.long(formatLeverage(long.maxLeverageE2)) : DASH} sub={long ? (short ? m.markets.short(formatLeverage(short.maxLeverageE2)) : m.markets.noShort) : undefined} />
                <Cell main={long ? formatWadPercent(long.borrowApyWad) : DASH} />
                <Cell main={long ? formatUsd(long.availableLiquidityRaw, 0) : DASH} sub={long ? "USDC" : undefined} />
                <Cell main={long ? formatUsd(long.maxPositionUsdRaw, 0) : DASH} />
                <td className="py-[18px] pr-7 pl-4">
                  <div className="flex justify-end gap-2">
                    {paused && <span className="self-center text-[13px] text-caution">{m.markets.paused}</span>}
                    <ButtonLink href={`/markets/${stock.symbol}`} variant="secondary" size="sm" className="hidden lg:inline-flex">
                      {m.markets.detail}
                    </ButtonLink>
                    <ButtonLink href={`/trade?symbol=${stock.symbol}`} size="sm" disabled={paused || row.stale}>
                      {m.markets.trade}
                    </ButtonLink>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!apiConfigured && <p className="px-7 pt-3 text-[13px] text-fg-3">{m.markets.limitsOffline}</p>}
    </div>
  );
}

function Cell({ main, sub, subTone }: { main: string | null; sub?: string; subTone?: string }) {
  return (
    <td className="px-4 py-[18px] tabular-nums">
      {main === null ? <Skeleton className="h-5 w-20" /> : <span className="block text-[15px] font-medium">{main}</span>}
      {sub && <span className={cn("block text-[13px] text-fg-2", subTone)}>{sub}</span>}
    </td>
  );
}
