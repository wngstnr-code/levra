"use client";

import { morphoAbi } from "@levra/shared/abis";
import type { EarnOption } from "@levra/shared/api";
import { useState } from "react";
import { erc4626Abi, type Address } from "viem";
import { useAccount } from "wagmi";
import { apiConfigured, queryKeys, useEarnAccount, useEarnOptions } from "@/lib/api/hooks";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { formatToken, formatTokenSigned, formatWadPercent, parseAmount } from "@/lib/units";
import { useEarnChain, type EarnChainOption } from "@/lib/useEarnChain";
import { useStoredFlag } from "@/lib/useStoredFlag";
import { trackStep } from "@/lib/metrics";
import { useTxFlow } from "@/lib/useTxFlow";
import { useGatedAction } from "../gate/Compliance";
import { useSignIn } from "../SignIn";
import { TxSheet } from "../tx/TxSheet";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { Money } from "../ui/Money";
import { Skeleton } from "../ui/Skeleton";
import { StatBox } from "../ui/StatBox";
import { TokenIcon } from "../ui/TokenIcon";

const DASH = "—";
type Mode = "supply" | "withdraw";

function apiFor(o: EarnChainOption, api: EarnOption[] | undefined) {
  return api?.find((a) => (o.kind === "vault" ? a.kind === "vault" : a.marketId?.toLowerCase() === o.marketId?.toLowerCase()));
}

function amountText(raw: bigint, o: EarnChainOption) {
  return `${formatToken(raw, o.decimals, o.decimals === 6 ? 2 : 4)} ${o.symbol}`;
}

export function EarnView() {
  const m = useT();
  const { address } = useAccount();
  const signIn = useSignIn();
  const chain = useEarnChain(address);
  const api = useEarnOptions();
  const mine = useEarnAccount(address);
  const [selected, setSelected] = useState<string>("vault");
  const [mode, setMode] = useState<Mode>("supply");
  const option = chain.options.find((o) => o.id === selected) ?? chain.options[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="pt-2 pb-4">
        <h1 className="text-display text-[40px] leading-tight font-semibold">{m.earn.title}</h1>
        <p className="mt-2 text-[15px] text-fg-2">{m.earn.subtitle}</p>
      </div>

      {chain.isPending ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 w-full rounded-card" />
          ))}
        </div>
      ) : chain.options.length === 0 ? (
        <EmptyState glyph="!" title={m.common.notAvailable} body={m.earn.noVault} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr_1fr]">
          {chain.options.map((o) => (
            <OptionCard key={o.id} o={o} api={apiFor(o, api.data?.options)} selected={option?.id === o.id} onSelect={() => setSelected(o.id)} />
          ))}
        </div>
      )}

      <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_440px]">
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">{m.earn.yourDeposits}</h2>
          {!address ? (
            <p className="text-[15px] text-fg-2">{m.earn.connect}</p>
          ) : (
            (() => {
              const held = chain.options.filter((o) => (o.user?.suppliedRaw ?? 0n) > 0n);
              if (held.length === 0) return <p className="text-[15px] text-fg-2">{m.earn.noDeposits}</p>;
              return held.map((o) => {
                const earned = mine.data?.positions.find((p) => p.optionId === apiFor(o, api.data?.options)?.id)?.earnedRaw;
                return (
                  <div key={o.id} className="squircle flex flex-wrap items-center gap-4 rounded-panel bg-surface-2 px-[18px] py-4">
                    <TokenIcon symbol={o.kind === "vault" ? "$" : o.symbol.slice(1)} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold">{o.kind === "vault" ? m.earn.vaultName : o.symbol}</p>
                      <p className="text-[13px] text-fg-2">
                        {amountText(o.user!.suppliedRaw, o)} · {m.earn.withdrawable(amountText(o.user!.withdrawableRaw, o))}
                      </p>
                    </div>
                    {earned && (
                      <p className="text-right">
                        <span className={cn("block text-[15px] font-semibold", BigInt(earned) > 0n ? "text-up" : BigInt(earned) < 0n ? "text-down" : "text-fg-2")}>
                          {formatTokenSigned(earned, o.decimals, o.decimals === 6 ? 2 : 4)}
                        </span>
                        <span className="text-xs text-fg-2">{m.earn.earned}</span>
                      </p>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelected(o.id);
                        setMode("withdraw");
                      }}
                    >
                      {m.earn.withdraw}
                    </Button>
                  </div>
                );
              });
            })()
          )}
          <p className="mt-auto text-[13px] text-fg-3">{m.earn.direct}</p>
        </Card>
        {option && <EarnPanel o={option} mode={mode} onMode={setMode} user={address} signIn={signIn} invalidate={[chain.queryKey, queryKeys.earnAccount(address ?? "none")]} />}
      </div>
    </div>
  );
}

function OptionCard({ o, api, selected, onSelect }: { o: EarnChainOption; api: EarnOption | undefined; selected: boolean; onSelect: () => void }) {
  const m = useT();
  const full = o.totalBorrowedRaw !== null && o.totalSuppliedRaw > 0n && o.totalBorrowedRaw >= o.totalSuppliedRaw;
  const util = api ? formatWadPercent(api.utilizationWad) : o.totalBorrowedRaw !== null && o.totalSuppliedRaw > 0n ? `${Number((o.totalBorrowedRaw * 1000n) / o.totalSuppliedRaw) / 10}%` : DASH;
  const available = api ? BigInt(api.availableToWithdrawRaw) : o.totalBorrowedRaw !== null ? o.totalSuppliedRaw - o.totalBorrowedRaw : null;
  return (
    <button onClick={onSelect} aria-pressed={selected} className={cn("squircle flex flex-col gap-4 rounded-card bg-surface-1 p-7 text-left transition-shadow", selected && "ring-2 ring-peri")}>
      <span className="flex items-center gap-3">
        <TokenIcon symbol={o.kind === "vault" ? "$" : o.symbol.slice(1)} size={40} />
        <span>
          <span className="block text-[17px] font-semibold">{o.kind === "vault" ? m.earn.vaultName : o.symbol}</span>
          <span className="block text-[13px] text-fg-2">{o.kind === "vault" ? m.earn.vaultSub : m.earn.marketSub}</span>
        </span>
      </span>
      <span>
        <span className="label-caps block">{m.earn.supplyApy}</span>
        {api ? <Money value={formatWadPercent(api.supplyApyWad, 2)} className="text-display mt-1 block text-[44px] leading-tight font-bold" /> : <span className="text-display mt-1 block text-[44px] leading-tight font-bold text-fg-3">{DASH}</span>}
        <span className="block text-[13px] text-fg-2">{api?.feeWad ? m.earn.afterFee(formatWadPercent(api.feeWad)) : !apiConfigured ? m.earn.apyOffline : " "}</span>
      </span>
      <span className="grid grid-cols-3 gap-2">
        <StatBox label={m.earn.supplied} value={amountText(o.totalSuppliedRaw, o).replace(/ \S+$/, "")} />
        <StatBox label={m.earn.borrowed} value={util} className={full ? "text-caution" : undefined} />
        <StatBox label={m.earn.canWithdraw} value={available === null ? DASH : available > 0n ? formatToken(available, o.decimals, 2) : m.earn.nothingNow} />
      </span>
      {full && <span className="text-xs text-caution">{m.earn.fullyBorrowed}</span>}
    </button>
  );
}

function EarnPanel({ o, mode, onMode, user, signIn, invalidate }: { o: EarnChainOption; mode: Mode; onMode: (m: Mode) => void; user: Address | undefined; signIn: (() => void) | null; invalidate: readonly (readonly unknown[])[] }) {
  const m = useT();
  const flow = useTxFlow();
  const [text, setText] = useState("");
  const [accepted, setAccepted] = useStoredFlag(user ? `levra.lenderRisk.${user.toLowerCase()}` : null);
  const amount = parseAmount(text, o.decimals);
  const limit = mode === "supply" ? (o.user?.walletRaw ?? 0n) : (o.user?.withdrawableRaw ?? 0n);
  const tooMuch = amount !== null && amount > limit;
  const where = o.kind === "vault" ? m.earn.vaultWhere : m.earn.marketWhere(o.symbol);
  const label = amount ? amountText(amount, o) : "";
  const needsRisk = mode === "supply" && !accepted;
  const isMax = amount !== null && amount === o.user?.withdrawableRaw && o.user?.withdrawableRaw === o.user?.suppliedRaw;
  const gated = useGatedAction();
  const supplyGate = mode === "supply" ? gated : null;

  const run = () => {
    if (!user || !amount || !o.user) return;
    if (mode === "supply") trackStep("supply_confirmed", { kind: o.kind });
    if (o.kind === "vault") {
      void flow.runDirect({
        account: user,
        approve: mode === "supply" ? { token: o.token, spender: o.target, amount, allowance: o.user.allowanceRaw } : undefined,
        call:
          mode === "supply"
            ? { address: o.target, abi: erc4626Abi, functionName: "deposit", args: [amount, user] }
            : isMax
              ? { address: o.target, abi: erc4626Abi, functionName: "redeem", args: [o.user.shares, user, user] }
              : { address: o.target, abi: erc4626Abi, functionName: "withdraw", args: [amount, user, user] },
        invalidate,
      });
    } else if (o.marketParams) {
      void flow.runDirect({
        account: user,
        approve: mode === "supply" ? { token: o.token, spender: o.target, amount, allowance: o.user.allowanceRaw } : undefined,
        call:
          mode === "supply"
            ? { address: o.target, abi: morphoAbi, functionName: "supply", args: [o.marketParams, amount, 0n, user, "0x"] }
            : { address: o.target, abi: morphoAbi, functionName: "withdraw", args: [o.marketParams, isMax ? 0n : amount, isMax ? o.user.shares : 0n, user, user] },
        invalidate,
      });
    }
  };

  return (
    <section className="squircle flex flex-col gap-3.5 rounded-card bg-peri p-6 text-ink">
      <div role="tablist" className="flex gap-1 rounded-full bg-ink/8 p-1">
        {(["supply", "withdraw"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={mode === t} onClick={() => onMode(t)} className={cn("flex-1 rounded-full py-2.5 text-sm font-semibold transition-colors", mode === t ? "bg-ink text-peri" : "text-ink")}>
            {t === "supply" ? m.earn.supply : m.earn.withdraw}
          </button>
        ))}
      </div>
      <label className="squircle block rounded-panel bg-ink/8 p-[18px]">
        <span className="text-xs font-semibold tracking-wide text-ink/60 uppercase">
          {m.earn.amount} · {o.kind === "vault" ? m.earn.vaultName : o.symbol}
        </span>
        <span className="mt-2 flex items-center gap-2">
          <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={text} onChange={(e) => setText(e.target.value)} className="text-display w-full min-w-0 bg-transparent text-[32px] font-semibold outline-none placeholder:text-ink/30" />
          <span className="shrink-0 text-sm font-semibold text-ink/70">{o.symbol}</span>
        </span>
        {o.user && (
          <span className="mt-2 flex text-[13px] text-ink/60">
            {mode === "supply" ? m.earn.inWallet(amountText(o.user.walletRaw, o)) : m.earn.withdrawable(amountText(o.user.withdrawableRaw, o))}
            <button type="button" onClick={() => setText(formatToken(limit, o.decimals, o.decimals).replace(/,/g, ""))} className="ml-1.5 font-semibold text-ink">
              {m.common.max}
            </button>
          </span>
        )}
      </label>
      {mode === "supply" && (
        <div className="squircle space-y-2.5 rounded-panel bg-ink/8 p-4">
          <p className="text-sm font-semibold">{m.earn.riskTitle}</p>
          <p className="text-[13px] leading-relaxed text-ink/75">{m.earn.riskBody}</p>
          <label className="flex cursor-pointer items-center gap-2.5 text-[13px] font-medium">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="size-5 accent-ink" />
            {m.earn.riskAccept}
          </label>
        </div>
      )}
      {!user ? (
        <button onClick={signIn ?? undefined} disabled={!signIn} className="squircle h-14 rounded-full bg-ink text-base font-semibold text-peri disabled:opacity-40">
          {m.earn.connect}
        </button>
      ) : supplyGate ? (
        <button onClick={supplyGate.onClick ?? undefined} disabled={!supplyGate.onClick} className="squircle h-14 rounded-full bg-ink text-base font-semibold text-peri disabled:opacity-40">
          {supplyGate.label}
        </button>
      ) : (
        <button onClick={flow.review} disabled={!amount || amount === 0n || tooMuch || needsRisk} className="squircle h-14 rounded-full bg-ink text-base font-semibold text-peri transition-transform active:scale-[0.97] disabled:bg-ink/20 disabled:text-ink/50">
          {mode === "supply" ? m.earn.supplyButton(label) : m.earn.withdrawButton(label)}
        </button>
      )}
      <TxSheet
        title={mode === "supply" ? m.earn.supply : m.earn.withdraw}
        state={flow.state}
        sentences={[...(mode === "supply" ? m.earn.sentencesSupply(label, where) : m.earn.sentencesWithdraw(label, where)), m.earn.contract(o.kind === "vault" ? m.earn.vaultName : "Morpho")]}
        signatures={0}
        approvals={mode === "supply" && o.user && amount && o.user.allowanceRaw < amount ? 1 : 0}
        confirmLabel={mode === "supply" ? m.earn.supplyButton(label) : m.earn.withdrawButton(label)}
        onConfirm={run}
        onClose={() => {
          if (flow.state.phase === "success") setText("");
          flow.reset();
        }}
      />
    </section>
  );
}
