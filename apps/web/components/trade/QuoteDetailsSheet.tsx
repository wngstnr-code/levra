"use client";

import type { QuoteOpenResponse } from "@levra/shared/api";
import { liquidationIncentiveFactorWad, WAD } from "@levra/shared/math";
import { cn } from "@/lib/cn";
import { formatUsdE8 } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { formatBps, formatUsd, formatWadPercent } from "@/lib/units";
import { Sheet } from "../ui/Sheet";

export function QuoteDetailsSheet({ open, onClose, quote, positionUsd }: { open: boolean; onClose: () => void; quote: QuoteOpenResponse | undefined; positionUsd: bigint }) {
  const m = useT();
  if (!quote) return null;
  const pv = quote.preview;
  const mk = quote.market;
  const bonus = liquidationIncentiveFactorWad(BigInt(mk.lltvWad)) - WAD;
  return (
    <Sheet open={open} onClose={onClose} title={m.trade.detailsTitle}>
      <Group title={m.trade.priceGroup}>
        <Item k={m.trade.execPrice} v={formatUsdE8(BigInt(pv.execPriceE8))} />
        <Item k={m.trade.oracle} v={formatUsdE8(BigInt(pv.oraclePriceE8))} />
        <Item k={m.trade.difference} v={formatBps(pv.deviationBps, { signed: true })} />
        <Item k={m.trade.priceImpact} v={formatBps(pv.priceImpactBps)} />
      </Group>
      <Group title={m.trade.gapGroup}>
        {pv.gapScenarios.map((s) => (
          <Item key={s.label} k={`${s.label} (${formatBps(s.moveBps, { signed: true, fractionDigits: 1 })})`} v={s.liquidated ? m.trade.liquidated : `${m.trade.ltv} ${formatWadPercent(s.ltvWad)} · ${m.trade.safe}`} tone={s.liquidated ? "text-down" : "text-up"} />
        ))}
      </Group>
      <Group title={m.trade.limitsGroup}>
        <Item k={m.trade.borrowRate} v={`${formatWadPercent(pv.borrowApyWad)} ${m.trade.variable}`} />
        <Item k={m.trade.position} v={m.trade.capUse(formatUsd(positionUsd), formatUsd(mk.maxPositionUsdRaw, 0))} />
        <Item k={m.trade.softLimit} v={`${formatWadPercent(mk.softLtvOpenWad)} · ${formatWadPercent(mk.softLtvClosedWad)}`} />
        <Item k={m.trade.liquidationAt} v={`${formatWadPercent(mk.lltvWad)} · ${m.trade.bonus(formatWadPercent(bonus))}`} />
        <Item k={m.trade.fee} v={formatUsd(pv.feeRaw)} />
      </Group>
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="label-caps">{title}</h3>
      <div className="squircle divide-y divide-line rounded-panel bg-surface-1">{children}</div>
    </section>
  );
}

function Item({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center gap-3 px-[18px] py-3 text-sm">
      <span className="text-fg-2">{k}</span>
      <span className={cn("ml-auto text-right font-medium tabular-nums", tone)}>{v}</span>
    </div>
  );
}
