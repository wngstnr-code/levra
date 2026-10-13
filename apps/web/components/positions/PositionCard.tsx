"use client";

import type { Position } from "@levra/shared/api";
import { cn } from "@/lib/cn";
import { stockOf } from "@/lib/deployment";
import { formatUsdE8 } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { formatBps, formatToken, formatUsd, formatUsdSigned, formatWadPercent, wadRatio } from "@/lib/units";
import { GapTry } from "../GapTry";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Ring } from "../ui/Ring";
import { StatBox } from "../ui/StatBox";
import { TokenIcon } from "../ui/TokenIcon";

export type ManageTab = "add" | "remove" | "repay" | "reduce" | "close";

export function PositionCard({ p, onManage, protectionControl, openSoftWad }: { p: Position; onManage: (tab: ManageTab) => void; protectionControl: React.ReactNode; openSoftWad?: string }) {
  const m = useT();
  const stock = stockOf(p.symbol);
  const long = p.side === "long";
  const ltvShare = wadRatio(p.ltvWad, p.lltvWad);
  const tone = p.overSoftLimit ? (ltvShare > 0.95 ? "down" : "caution") : "up";
  const stockAmt = stock ? `${formatToken(p.stockAmountRaw, stock.decimals)} ${stock.tokenSymbol}` : p.stockAmountRaw;
  const pnl = BigInt(p.unrealizedPnlUsdRaw);
  const worst = p.gapScenarios[0];
  const lev = BigInt(p.equityUsdRaw) > 0n ? Number((BigInt(p.valueUsdRaw) * 100n) / BigInt(p.equityUsdRaw)) / 100 : null;

  return (
    <Card className={cn("flex flex-col gap-6", p.overSoftLimit && "ring-2 ring-caution/60")}>
      <div className="flex flex-wrap items-center gap-3.5">
        <TokenIcon symbol={p.symbol} size={44} />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-semibold">{stock?.tokenSymbol ?? p.symbol}</span>
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold text-ink", long ? "bg-lime" : "bg-peach")}>{long ? m.trade.long : m.trade.short}</span>
          </div>
          <span className="text-[13px] text-fg-2">{long ? m.positions.size(stockAmt, lev ? `${lev.toFixed(1)}×` : "") : m.positions.borrowed(stockAmt)}</span>
        </div>
        {p.overSoftLimit && <span className="rounded-full bg-caution-soft px-3 py-1.5 text-[13px] font-semibold text-caution">● {m.positions.aboveSoft}</span>}
        <div className="ml-auto">{protectionControl}</div>
      </div>
      {p.overSoftLimit && <p className="-mt-2 text-sm text-fg-2">{m.positions.aboveSoftBody(formatWadPercent(p.ltvWad), formatWadPercent(p.softLtvWad), formatWadPercent(p.lltvWad))}</p>}

      <div className="flex flex-wrap items-center gap-8">
        <Ring value={ltvShare} mark={wadRatio(p.softLtvWad, p.lltvWad)} faintMark={openSoftWad && BigInt(openSoftWad) > BigInt(p.softLtvWad) ? wadRatio(openSoftWad, p.lltvWad) : undefined} tone={tone} label={`${m.positions.ltv} ${formatWadPercent(p.ltvWad)}`}>
          <span className="font-rounded text-[28px] font-semibold">{formatWadPercent(p.ltvWad)}</span>
          <span className="text-xs text-fg-2">{m.positions.ltv}</span>
        </Ring>
        <div className="min-w-0 flex-1 space-y-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat k={long ? m.positions.value : m.positions.debtValue} v={formatUsd(p.valueUsdRaw)} />
            <Stat k={long ? m.positions.debt : m.positions.collateral} v={`${formatToken(long ? p.debtRaw : p.collateralRaw, 6, 2)} USDC`} />
            <Stat k={m.positions.equity} v={formatUsd(p.equityUsdRaw)} />
            <Stat k={m.positions.entry} v={BigInt(p.entryPriceE8) > 0n ? formatUsdE8(BigInt(p.entryPriceE8)) : "—"} />
            <Stat k={m.positions.pnl} v={formatUsdSigned(pnl)} tone={pnl > 0n ? "text-up" : pnl < 0n ? "text-down" : undefined} />
          </dl>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatBox label={m.positions.liqPrice} value={formatUsdE8(BigInt(p.liqPriceE8))} sub={(long ? m.positions.below : m.positions.above)(formatBps(Math.abs(p.liqDistanceBps), { fractionDigits: 0 }))} />
            <StatBox label={m.positions.softLimit} value={formatWadPercent(p.softLtvWad)} sub={`${m.trade.hard(formatWadPercent(p.lltvWad))}`} />
            {worst && (
              <StatBox
                label={m.positions.worstGap(formatBps(worst.moveBps, { signed: true, fractionDigits: 1 }))}
                value={worst.liquidated ? m.trade.liquidated : `${m.positions.ltv} ${formatWadPercent(worst.ltvWad)}`}
                sub={worst.liquidated ? m.positions.wouldLiquidate : m.positions.safe}
              />
            )}
          </div>
          <GapTry side={p.side} ltvWad={p.ltvWad} softWad={p.softLtvWad} lltvWad={p.lltvWad} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onManage("add")}>{m.positions.addCollateral}</Button>
        <Button variant="secondary" onClick={() => onManage("remove")}>{m.positions.remove}</Button>
        <Button variant="secondary" onClick={() => onManage("repay")}>{m.positions.repay}</Button>
        <Button variant="secondary" onClick={() => onManage("reduce")}>{m.positions.reduce}</Button>
        <Button className="ml-auto" onClick={() => onManage("close")}>
          {m.positions.close}
        </Button>
      </div>
    </Card>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-2">{k}</dt>
      <dd className={cn("mt-1 truncate text-xl font-semibold tabular-nums", tone)}>{v}</dd>
    </div>
  );
}
