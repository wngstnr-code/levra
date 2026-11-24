"use client";

import { apiConfigured, useStats } from "@/lib/api/hooks";
import { formatAge } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { formatUsd } from "@/lib/units";
import { useChain } from "@/lib/useChain";
import { useNowSeconds } from "@/lib/useNow";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";
import { StatBox } from "../ui/StatBox";

export function StatsView() {
  const m = useT();
  const s = m.stats;
  const chain = useChain();
  const stats = useStats();
  const now = useNowSeconds();
  const d = stats.data;

  const header = (
    <div className="space-y-1 pt-2 pb-4">
      <h1 className="text-display text-[40px] leading-tight font-semibold">{s.title}</h1>
      <p className="text-fg-2">{s.sub(chain.name)}</p>
    </div>
  );

  if (!apiConfigured || stats.isError) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState glyph="!" title={m.common.notAvailable} body={s.loadError} />
      </div>
    );
  }

  if (!d) {
    return (
      <div className="space-y-4">
        {header}
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-panel" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <p className="label-caps">{s.wallets}</p>
          <p className="text-display text-[44px] leading-none font-semibold">{d.wallets.total}</p>
          <div className="grid grid-cols-2 gap-3">
            <StatBox label={s.traders} value={d.wallets.traders} />
            <StatBox label={s.lenders} value={d.wallets.lenders} />
          </div>
        </Card>
        <Card className="flex flex-col gap-4">
          <p className="label-caps">{s.openInterest}</p>
          <p className="text-display text-[44px] leading-none font-semibold">{formatUsd(BigInt(d.openInterest.longUsdRaw) + BigInt(d.openInterest.shortUsdRaw))}</p>
          <div className="grid grid-cols-3 gap-3">
            <StatBox label={s.long} value={formatUsd(d.openInterest.longUsdRaw)} />
            <StatBox label={s.short} value={formatUsd(d.openInterest.shortUsdRaw)} />
            <StatBox label={s.positions(d.openInterest.openPositions)} value={d.openInterest.openPositions} />
          </div>
        </Card>
        <Card className="flex flex-col gap-4">
          <p className="label-caps">{s.volume}</p>
          <p className="text-display text-[44px] leading-none font-semibold">{formatUsd(d.volume.totalUsdRaw)}</p>
          <div className="grid grid-cols-3 gap-3">
            <StatBox label={s.day} value={formatUsd(d.volume.last24hUsdRaw)} />
            <StatBox label={s.week} value={formatUsd(d.volume.last7dUsdRaw)} />
            <StatBox label={s.total} value={s.trades(d.volume.trades)} />
          </div>
        </Card>
        <Card className="flex flex-col gap-4">
          <p className="label-caps">{s.earn}</p>
          <p className="text-display text-[44px] leading-none font-semibold">{formatUsd(d.earn.suppliedUsdRaw)}</p>
        </Card>
      </div>
      <p className="text-xs text-fg-3">
        {s.note} {s.updated(formatAge(Math.max(0, now - d.updatedAt)))}
      </p>
    </div>
  );
}
