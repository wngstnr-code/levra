"use client";

import { tokens } from "@levra/shared/addresses";
import type { Position } from "@levra/shared/api";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { apiConfigured, useAccountData } from "@/lib/api/hooks";
import { monad } from "@/lib/chain";
import { cn } from "@/lib/cn";
import { describeError } from "@/lib/contractErrors";
import { useT } from "@/lib/i18n";
import { formatToken, formatUsd, formatUsdSigned } from "@/lib/units";
import { useSignIn } from "../SignIn";
import { Button, ButtonLink } from "../ui/Button";
import { Card } from "../ui/Card";
import { ChangePill } from "../ui/ChangePill";
import { EmptyState } from "../ui/EmptyState";
import { Money } from "../ui/Money";
import { Skeleton } from "../ui/Skeleton";
import { StatBox } from "../ui/StatBox";
import { HistoryList } from "./HistoryList";
import { ManageSheet } from "./ManageSheet";
import { PositionCard, type ManageTab } from "./PositionCard";

export function PositionsView({ protectionControl, topRight }: { protectionControl?: (p: Position) => React.ReactNode; topRight?: React.ReactNode }) {
  const m = useT();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const tab = search.get("tab") === "history" ? "history" : "open";
  const { address } = useAccount();
  const signIn = useSignIn();
  const account = useAccountData(address);
  const [manage, setManage] = useState<{ marketId: string; tab: ManageTab } | null>(null);
  const usdc = useReadContract({ address: tokens.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: monad.id, query: { enabled: !!address } });
  const mon = useBalance({ address, chainId: monad.id, query: { enabled: !!address } });
  const managed = account.data?.positions.find((p) => p.marketId === manage?.marketId) ?? null;

  const header = (
    <div className="flex flex-wrap items-center gap-4 pt-2 pb-4">
      <h1 className="text-display flex-1 text-[40px] leading-tight font-semibold">{m.positions.title}</h1>
      <div role="tablist" className="flex gap-1 rounded-full bg-surface-1 p-[5px]">
        {(["open", "history"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => router.replace(t === "open" ? pathname : `${pathname}?tab=history`, { scroll: false })}
            className={cn("rounded-full px-[18px] py-[9px] text-sm font-medium transition-colors", tab === t ? "bg-surface-3 text-fg" : "text-fg-2 hover:text-fg")}
          >
            {t === "open" ? m.positions.open : m.positions.history}
          </button>
        ))}
      </div>
    </div>
  );

  if (!address) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState glyph="◎" tone="lime" title={m.positions.connectTitle} body={m.positions.connectBody} action={signIn && <Button onClick={signIn}>{m.wallet.signIn}</Button>} />
      </div>
    );
  }

  if (tab === "history") {
    return (
      <div className="space-y-4">
        {header}
        {apiConfigured ? <HistoryList address={address} /> : <EmptyState glyph="!" title={m.status.offlineTitle} body={m.positions.offline} />}
      </div>
    );
  }

  const totals = account.data?.totals;
  const pnl = totals ? BigInt(totals.unrealizedPnlUsdRaw) : 0n;
  const positions = account.data?.positions ?? [];

  return (
    <div className="space-y-4">
      {header}
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Card className="flex flex-col gap-5 p-8">
          <p className="label-caps">{m.positions.totalEquity}</p>
          <div className="flex flex-wrap items-center gap-4">
            {totals ? <Money value={formatUsd(totals.equityUsdRaw)} className="text-display text-[56px] leading-none font-bold sm:text-[64px]" /> : <Skeleton className="h-16 w-64" />}
            {totals && pnl !== 0n && <ChangePill direction={pnl > 0n ? "up" : "down"}>{formatUsdSigned(pnl)}</ChangePill>}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatBox label={m.positions.debt} value={totals ? formatUsd(totals.debtUsdRaw) : "—"} />
            <StatBox label={m.positions.unrealized} value={totals ? formatUsdSigned(pnl) : "—"} />
            <StatBox label={m.positions.wallet} value={usdc.data !== undefined ? `${formatToken(usdc.data, 6, 2)} USDC` : "—"} />
            <StatBox label={m.positions.gas} value={mon.data ? `${formatToken(mon.data.value, 18, 2)} MON` : "—"} />
          </div>
        </Card>
        {topRight}
      </div>

      {!apiConfigured ? (
        <EmptyState glyph="!" title={m.status.offlineTitle} body={m.positions.offline} />
      ) : account.isPending ? (
        <Skeleton className="h-80 w-full rounded-card" />
      ) : account.isError ? (
        <EmptyState glyph="!" tone="down" title={m.common.notAvailable} body={`${describeError(account.error, m)} ${m.positions.loadError}`} action={<Button variant="secondary" onClick={() => account.refetch()}>{m.common.tryAgain}</Button>} />
      ) : positions.length === 0 ? (
        <EmptyState glyph="+" title={m.positions.noneTitle} body={m.positions.noneBody} action={<ButtonLink href="/markets" variant="secondary">{m.positions.goMarkets}</ButtonLink>} />
      ) : (
        positions.map((p) => (
          <PositionCard
            key={p.marketId}
            p={p}
            onManage={(t) => setManage({ marketId: p.marketId, tab: t })}
            protectionControl={
              protectionControl?.(p) ?? (
                <span className="text-sm text-fg-2">
                  {m.positions.protection} · {p.protection ? m.positions.on : m.positions.off}
                </span>
              )
            }
          />
        ))
      )}

      {managed && manage && <ManageSheet key={`${manage.marketId}`} position={managed} tab={manage.tab} onTab={(t) => setManage({ ...manage, tab: t })} onClose={() => setManage(null)} user={address} />}
    </div>
  );
}
