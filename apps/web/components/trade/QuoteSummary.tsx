"use client";

import type { Market, QuoteOpenResponse } from "@levra/shared/api";
import { cn } from "@/lib/cn";
import { formatUsdE8 } from "@/lib/format";
import { apiConfigured } from "@/lib/api/hooks";
import { gapSteps, mergeGapScenarios } from "@/lib/gapSteps";
import { useT } from "@/lib/i18n";
import { formatBps, formatToken, formatUsd, formatWadPercent, stockValueUsd, wadRatio } from "@/lib/units";
import { GapTry } from "../GapTry";
import { Card } from "../ui/Card";
import { InfoLink } from "../ui/InfoLink";
import { Money } from "../ui/Money";
import { Ring } from "../ui/Ring";
import { Skeleton } from "../ui/Skeleton";

type Props = {
  side: "long" | "short";
  market: Market | null;
  quote: QuoteOpenResponse | undefined;
  loading: boolean;
  error: string | null;
  tokenSymbol: string;
  stockDecimals: number;
  secondsLeft: number | null;
  signedIn: boolean;
  onDetails: () => void;
};

/** Why there is no quote yet: no service, no wallet, or no amount. */
function useEmptyText(signedIn: boolean) {
  const m = useT();
  return !apiConfigured ? m.trade.summaryOffline : signedIn ? m.trade.emptySummary : m.trade.summarySignIn;
}

export function QuoteSummary(p: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_340px]">
      <AfterCard {...p} />
      <GapCard {...p} />
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-sm">
      <span className="text-fg-2">{k}</span>
      <span className={cn("ml-auto text-right font-medium tabular-nums", tone)}>{v}</span>
    </div>
  );
}

function AfterCard({ side, market, quote, loading, error, tokenSymbol, stockDecimals, secondsLeft, signedIn, onDetails }: Props) {
  const emptyText = useEmptyText(signedIn);
  const m = useT();
  const pv = quote?.preview;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center">
        <h2 className="text-xl font-semibold">{m.trade.afterTitle}</h2>
        {secondsLeft !== null && <span className="ml-auto text-xs text-fg-3">{m.trade.refreshesIn(secondsLeft)}</span>}
      </div>
      {!pv ? (
        loading ? (
          <div className="space-y-3">
            <Skeleton className="h-36 w-36" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : (
          <p className={cn("text-[15px]", error ? "text-down" : "text-fg-2")}>{error ?? emptyText}</p>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-6">
            <Ring
              value={wadRatio(pv.ltvAfterWad, quote.market.lltvWad)}
              mark={wadRatio(quote.market.currentSoftLtvWad, quote.market.lltvWad)}
              tone={BigInt(pv.ltvAfterWad) > BigInt(quote.market.currentSoftLtvWad) ? "caution" : "up"}
              label={`${m.trade.ltv} ${formatWadPercent(pv.ltvAfterWad)}`}
            >
              <span className="font-rounded text-[28px] font-semibold">{formatWadPercent(pv.ltvAfterWad)}</span>
              <span className="text-xs text-fg-2">{m.trade.ltv}</span>
            </Ring>
            <div className="min-w-0 flex-1">
              <p className="label-caps">
                {m.trade.liqPrice}
                <InfoLink term="liquidation-price" label={m.trade.liqPrice} />
              </p>
              <Money value={formatUsdE8(BigInt(pv.liqPriceE8))} className="text-display mt-1 block text-[32px] font-semibold" />
              <p className="mt-1 text-[13px] text-fg-2">{(side === "long" ? m.trade.liqBelow : m.trade.liqAbove)(formatBps(Math.abs(pv.liqDistanceBps), { fractionDigits: 0 }))}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
                <Legend dot="bg-up" text={m.trade.now(formatWadPercent(pv.ltvAfterWad))} />
                <Legend dot="bg-caution" text={m.trade.soft(formatWadPercent(quote.market.currentSoftLtvWad))} />
                <Legend dot="bg-down" text={m.trade.hard(formatWadPercent(quote.market.lltvWad))} />
              </div>
            </div>
          </div>
          <div>
            {side === "long" ? (
              <>
                <Row k={m.trade.youGet} v={`${formatToken(pv.stockAmountRaw, stockDecimals)} ${tokenSymbol} · ${formatUsd(stockValueUsd(pv.stockAmountRaw, pv.oraclePriceE8, stockDecimals))}`} />
                <Row k={m.trade.debt} v={`${formatToken(pv.debtRaw, 6, 2)} USDC`} />
              </>
            ) : (
              <>
                <Row k={m.trade.youSell} v={`${formatToken(pv.stockAmountRaw, stockDecimals)} ${tokenSymbol}`} />
                <Row k={m.trade.collateralAfter} v={`${formatToken(pv.collateralRaw, 6, 2)} USDC`} />
              </>
            )}
            <Row k={m.trade.execPrice} v={`${formatUsdE8(BigInt(pv.execPriceE8))} · ${m.trade.vsOracle(formatBps(pv.deviationBps, { signed: true }))}`} />
            <Row k={m.trade.priceImpact} v={formatBps(pv.priceImpactBps)} tone={pv.priceImpactBps > 300 ? "text-caution" : undefined} />
            <Row k={m.trade.fee} v={formatUsd(pv.feeRaw)} />
            <Row k={m.trade.borrowRate} v={`${formatWadPercent(pv.borrowApyWad)} ${m.trade.variable}`} />
          </div>
          <button onClick={onDetails} className="squircle mt-auto flex items-center gap-2 rounded-panel bg-surface-2 px-[18px] py-3.5 text-left transition-colors hover:bg-surface-3">
            <span className="text-[15px] font-medium">{m.trade.detailsTitle}</span>
            <span className="truncate text-[13px] text-fg-2">{m.trade.detailsButton}</span>
            <span aria-hidden className="ml-auto text-fg-2">›</span>
          </button>
        </>
      )}
      {!pv && market && <p className="text-[13px] text-fg-3">{m.trade.capUse("$0", formatUsd(market.maxPositionUsdRaw, 0))}</p>}
    </Card>
  );
}

function Legend({ dot, text }: { dot: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-2 rounded-full", dot)} />
      {text}
    </span>
  );
}

function GapCard({ quote, loading, error, side, signedIn }: Props) {
  const emptyText = useEmptyText(signedIn);
  const m = useT();
  const noLoan = !!quote && BigInt(quote.preview.debtRaw) === 0n;
  const worst = quote?.preview.gapScenarios ?? [];
  const scenarios = quote && !noLoan ? mergeGapScenarios(worst, gapSteps(side, quote.preview.ltvAfterWad, quote.market.lltvWad, (b) => m.trade.gapStep(formatBps(b, { signed: true, fractionDigits: 0 })))) : [];
  const lltv = quote ? BigInt(quote.market.lltvWad) : 0n;
  const top = lltv + lltv / 10n;
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">
          {m.trade.gapTitle}
          <InfoLink term="price-gap" label={m.trade.gapTitle} />
        </h2>
        <p className="mt-1 text-[13px] text-fg-2">{m.trade.gapSub}</p>
      </div>
      {noLoan ? (
        <p className="text-[15px] text-fg-2">{m.trade.gapNoLoan}</p>
      ) : scenarios.length === 0 ? (
        loading ? <Skeleton className="h-48 w-full rounded-panel" /> : <p className={cn("text-[15px]", error ? "text-down" : "text-fg-3")}>{error ?? emptyText}</p>
      ) : (
        <div className="flex min-h-48 flex-1 items-end gap-3">
          {scenarios.map((s) => (
            <div key={s.label} className="flex h-full min-w-0 flex-1 flex-col items-center gap-2">
              <span className={cn("text-[13px] font-semibold tabular-nums", s.liquidated && "text-down")}>{s.liquidated ? m.trade.liquidated : formatWadPercent(s.ltvWad)}</span>
              <div className="relative w-full flex-1 overflow-hidden rounded-full bg-surface-3" title={s.label}>
                <div className={cn("absolute inset-x-0 bottom-0 rounded-full", s.liquidated ? "bg-down" : "bg-peri")} style={{ height: `${Math.round(wadRatio(s.ltvWad, top) * 100)}%` }} />
              </div>
              <span className="text-center text-[11px] leading-tight text-fg-2">{formatBps(s.moveBps, { signed: true, fractionDigits: 1 })}</span>
            </div>
          ))}
        </div>
      )}
      {!noLoan && worst[0] && <p className="text-xs text-fg-3">{m.trade.gapWorst(worst[0].label, formatBps(worst[0].moveBps, { signed: true, fractionDigits: 1 }))}</p>}
      {quote && !noLoan && <GapTry side={side} ltvWad={quote.preview.ltvAfterWad} softWad={quote.market.currentSoftLtvWad} lltvWad={quote.market.lltvWad} />}
    </Card>
  );
}
