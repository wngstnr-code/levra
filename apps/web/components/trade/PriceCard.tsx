"use client";

import type { Market } from "@levra/shared/api";
import { formatAge, formatUsdE8 } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { formatBps, formatUsd, formatWadPercent } from "@/lib/units";
import { useNowSeconds } from "@/lib/useNow";
import { Card } from "../ui/Card";
import { Money } from "../ui/Money";
import { Skeleton } from "../ui/Skeleton";
import { StatBox } from "../ui/StatBox";

const DASH = "—";

/** The oracle price of the chosen stock, and the market facts that limit a trade. */
export function PriceCard({ market, priceE8, feedUpdatedAt, capRaw, children }: { market: Market | null; priceE8: bigint | null; feedUpdatedAt: number | null; capRaw: bigint | null; children?: React.ReactNode }) {
  const m = useT();
  const now = useNowSeconds();
  return (
    <Card className="flex flex-col gap-5">
      <div>
        <p className="label-caps">{m.trade.oraclePrice}</p>
        {priceE8 === null ? <Skeleton className="mt-2 h-11 w-52" /> : <Money value={formatUsdE8(priceE8)} className="text-display mt-1 block text-[44px] leading-tight font-semibold" />}
        <p className="mt-1 text-[13px] text-fg-2">{feedUpdatedAt ? m.trade.quoteAge(formatAge(now - feedUpdatedAt)) : DASH}</p>
      </div>
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
