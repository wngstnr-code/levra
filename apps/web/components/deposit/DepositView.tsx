"use client";

import { tokens as monadTokens } from "@levra/shared/addresses";
import type { DepositQuoteResponse, DepositToken, WithdrawQuoteResponse } from "@levra/shared/api";
import { useMutation } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { erc20Abi, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { api } from "@/lib/api/client";
import { apiConfigured, useDepositTokens } from "@/lib/api/hooks";
import { monad } from "@/lib/chain";
import { cn } from "@/lib/cn";
import { describeError } from "@/lib/contractErrors";
import { formatAge } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useSavedTransfers } from "@/lib/transfers";
import { formatDuration, formatToken, parseAmount } from "@/lib/units";
import { useNowSeconds } from "@/lib/useNow";
import { useTxFlow } from "@/lib/useTxFlow";
import { useGate, useGatedAction } from "../gate/Compliance";
import { useSignIn } from "../SignIn";
import { TxSheet } from "../tx/TxSheet";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { Money } from "../ui/Money";
import { Skeleton } from "../ui/Skeleton";
import { Switch } from "../ui/Switch";
import { QrCode } from "./QrCode";
import { TransferStatus } from "./TransferStatus";

type Tab = "deposit" | "withdraw";

export function DepositView() {
  const m = useT();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const tab: Tab = search.get("tab") === "withdraw" ? "withdraw" : "deposit";
  const { address } = useAccount();
  const signIn = useSignIn();
  const list = useDepositTokens();
  const saved = useSavedTransfers(address);
  const gateStatus = useGate().status;

  return (
    <div className="space-y-4">
      <div className="pt-2 pb-4">
        <h1 className="text-display text-[40px] leading-tight font-semibold">{tab === "deposit" ? m.deposit.title : m.deposit.withdrawTitle}</h1>
        <p className="mt-2 text-[15px] text-fg-2">{tab === "deposit" ? m.deposit.subtitle : m.deposit.withdrawSubtitle}</p>
      </div>
      {!address ? (
        <EmptyState glyph="◎" tone="lime" title={m.positions.connectTitle} body={m.deposit.connect} action={signIn && <Button onClick={signIn}>{m.wallet.signIn}</Button>} />
      ) : !apiConfigured ? (
        <EmptyState glyph="!" title={m.status.offlineTitle} body={m.deposit.offline} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[460px_1fr]">
          <section className="squircle flex flex-col gap-3 rounded-card bg-lilac p-6 text-ink">
            <div role="tablist" className="flex gap-1 rounded-full bg-ink/8 p-1">
              {(["deposit", "withdraw"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => router.replace(t === "deposit" ? pathname : `${pathname}?tab=withdraw`, { scroll: false })} className={cn("flex-1 rounded-full py-2.5 text-sm font-semibold transition-colors", tab === t ? "bg-ink text-lilac" : "text-ink")}>
                  {t === "deposit" ? m.deposit.tabDeposit : m.deposit.tabWithdraw}
                </button>
              ))}
            </div>
            {list.isPending ? (
              <Skeleton className="h-64 w-full rounded-panel bg-ink/10" />
            ) : list.isError ? (
              <p className="text-sm">{describeError(list.error, m)}</p>
            ) : tab === "deposit" && gateStatus === "blocked" ? (
              <p className="text-sm">{m.gate.blockedBody}</p>
            ) : tab === "deposit" ? (
              <DepositForm user={address} tokens={list.data.tokens} onQuoted={(q, label) => saved.add({ id: q.id, kind: "deposit", label, createdAt: Math.floor(Date.now() / 1000) })} />
            ) : (
              <WithdrawForm user={address} tokens={list.data.tokens} onSent={(id, label) => saved.add({ id, kind: "withdraw", label, createdAt: Math.floor(Date.now() / 1000) })} />
            )}
          </section>
          <Recent saved={saved.list} />
        </div>
      )}
    </div>
  );
}

function chainsOf(tokens: DepositToken[]) {
  return [...new Map(tokens.map((t) => [t.chain, t.chainName])).entries()];
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="squircle block rounded-panel bg-ink/8 px-[18px] py-3.5">
      <span className="text-xs font-semibold tracking-wide text-ink/60 uppercase">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-xs text-ink/60">{hint}</span>}
    </label>
  );
}

const selectCls = "w-full cursor-pointer bg-transparent text-[17px] font-semibold outline-none";
const inputCls = "w-full bg-transparent text-[17px] font-semibold outline-none placeholder:text-ink/30";

function TokenPickers({ tokens, chain, onChain, token, onToken, chainLabel }: { tokens: DepositToken[]; chain: string; onChain: (c: string) => void; token: string; onToken: (t: string) => void; chainLabel: string }) {
  const m = useT();
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Field label={chainLabel}>
        <select value={chain} onChange={(e) => onChain(e.target.value)} className={selectCls}>
          {chainsOf(tokens).map(([c, name]) => (
            <option key={c} value={c} className="bg-surface-2 text-fg">
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={m.deposit.token}>
        <select value={token} onChange={(e) => onToken(e.target.value)} className={selectCls}>
          {tokens
            .filter((t) => t.chain === chain)
            .map((t) => (
              <option key={t.token} value={t.token} className="bg-surface-2 text-fg">
                {t.symbol}
              </option>
            ))}
        </select>
      </Field>
    </div>
  );
}

function usePicked(tokens: DepositToken[]) {
  const firstUsdc = tokens.find((t) => t.symbol.toUpperCase() === "USDC") ?? tokens[0];
  const [chain, setChain] = useState(firstUsdc?.chain ?? "");
  const [tokenId, setTokenId] = useState(firstUsdc?.token ?? "");
  const picked = tokens.find((t) => t.chain === chain && t.token === tokenId) ?? tokens.find((t) => t.chain === chain) ?? null;
  const onChain = (c: string) => {
    setChain(c);
    const t = tokens.find((x) => x.chain === c && x.symbol.toUpperCase() === "USDC") ?? tokens.find((x) => x.chain === c);
    setTokenId(t?.token ?? "");
  };
  return { chain, onChain, tokenId: picked?.token ?? "", setTokenId, picked };
}

function DepositForm({ user, tokens, onQuoted }: { user: Address; tokens: DepositToken[]; onQuoted: (q: DepositQuoteResponse, label: string) => void }) {
  const m = useT();
  const now = useNowSeconds();
  const { chain, onChain, tokenId, setTokenId, picked } = usePicked(tokens);
  const [amountText, setAmountText] = useState("");
  const [refund, setRefund] = useState("");
  const [includeGas, setIncludeGas] = useState(true);
  const [copied, setCopied] = useState(false);
  const amount = picked ? parseAmount(amountText, picked.decimals) : null;
  const belowMin = !!picked?.minAmountRaw && amount !== null && amount < BigInt(picked.minAmountRaw);
  const gated = useGatedAction();
  const quote = useMutation({
    mutationFn: () => api("depositQuote", { body: { recipient: user, originChain: chain, originToken: tokenId, amountRaw: amount!.toString(), refundAddress: refund.trim(), includeGas } }),
    onSuccess: (q) => onQuoted(q, `${amountText} ${picked?.symbol} · ${picked?.chainName}`),
  });
  const q = quote.data;

  if (q && picked) {
    const expired = q.expiresAt <= now;
    return (
      <div className="flex flex-col gap-3.5">
        <p className="text-xs font-semibold tracking-wide text-ink/60 uppercase">{m.deposit.sendExactly}</p>
        <Money value={`${formatToken(amount!, picked.decimals, Math.min(6, picked.decimals))} ${picked.symbol}`} className="text-display text-[32px] leading-none font-semibold" decimalsClassName="text-ink/40" />
        <p className="text-sm text-ink/70">{m.deposit.onChainTo(picked.chainName)}</p>
        <div className="flex flex-wrap items-center gap-4">
          <QrCode value={q.depositAddress} size={150} label={q.depositAddress} />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-semibold break-all">{q.depositAddress}</p>
            {q.depositMemo && (
              <p className="text-sm">
                {m.deposit.memo}: <span className="font-semibold break-all">{q.depositMemo}</span>
              </p>
            )}
            <button
              onClick={() => navigator.clipboard.writeText(q.depositAddress).then(() => setCopied(true))}
              className="squircle rounded-full bg-ink px-4 py-2 text-sm font-semibold text-lilac transition-transform active:scale-[0.97]"
            >
              {copied ? m.deposit.copied : m.deposit.copy}
            </button>
            <p className={cn("text-[13px]", expired ? "font-semibold text-ink" : "text-ink/60")}>{expired ? m.deposit.expired : `${m.deposit.expiresIn(formatDuration(q.expiresAt - now))} · ${m.deposit.anyWallet}`}</p>
          </div>
        </div>
        <div className="squircle rounded-panel bg-ink/8 px-4 py-2 text-sm">
          <p className="flex py-1">
            <span className="text-ink/70">{m.deposit.youReceive}</span>
            <span className="ml-auto font-semibold">{formatToken(q.amountOutRaw, 6, 2)} USDC</span>
          </p>
          {q.gasOutRaw && (
            <p className="flex py-1">
              <span className="text-ink/70">{m.deposit.plusGas}</span>
              <span className="ml-auto font-semibold">{formatToken(q.gasOutRaw, 18, 4)} MON</span>
            </p>
          )}
          <p className="flex py-1">
            <span className="text-ink/70">{m.deposit.time}</span>
            <span className="ml-auto font-semibold">{m.deposit.about(formatAge(q.estimatedSeconds))}</span>
          </p>
        </div>
        <div className="squircle rounded-panel bg-surface-1 p-5 text-fg">
          <p className="mb-3 text-[15px] font-semibold">{m.deposit.status}</p>
          <TransferStatus id={q.id} kind="deposit" chainName={picked.chainName} />
        </div>
        <button onClick={() => quote.reset()} className="text-sm font-semibold underline-offset-2 hover:underline">
          {m.deposit.newDeposit}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <TokenPickers tokens={tokens} chain={chain} onChain={onChain} token={tokenId} onToken={setTokenId} chainLabel={m.deposit.from} />
      <Field label={m.deposit.amount} hint={picked?.minAmountRaw ? m.deposit.minimum(`${formatToken(picked.minAmountRaw, picked.decimals, 2)} ${picked.symbol}`) : undefined}>
        <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={amountText} onChange={(e) => setAmountText(e.target.value)} className={cn(inputCls, "text-display text-[28px]")} />
      </Field>
      <Field label={m.deposit.refund(picked?.chainName ?? "")} hint={m.deposit.refundHint}>
        <input autoComplete="off" spellCheck={false} placeholder="0x…" value={refund} onChange={(e) => setRefund(e.target.value)} className={inputCls} />
      </Field>
      <div className="squircle flex items-center gap-3 rounded-panel bg-ink/8 px-[18px] py-3">
        <span className="flex-1 text-sm font-medium">{m.deposit.includeGas}</span>
        <Switch on={includeGas} onClick={() => setIncludeGas((v) => !v)} label={m.deposit.includeGas} />
      </div>
      {quote.isError && <p className="text-sm font-medium">{describeError(quote.error, m)}</p>}
      {gated ? (
        <button onClick={gated.onClick ?? undefined} disabled={!gated.onClick} className="squircle h-14 rounded-full bg-ink text-base font-semibold text-lilac disabled:opacity-40">
          {gated.label}
        </button>
      ) : (
        <button
          onClick={() => quote.mutate()}
          disabled={!picked || !amount || belowMin || !refund.trim() || quote.isPending}
          className="squircle h-14 rounded-full bg-ink text-base font-semibold text-lilac transition-transform active:scale-[0.97] disabled:bg-ink/20 disabled:text-ink/50"
        >
          {quote.isPending ? m.deposit.gettingAddress : m.deposit.getAddress}
        </button>
      )}
    </div>
  );
}

function WithdrawForm({ user, tokens, onSent }: { user: Address; tokens: DepositToken[]; onSent: (id: string, label: string) => void }) {
  const m = useT();
  const now = useNowSeconds();
  const flow = useTxFlow();
  const { chain, onChain, tokenId, setTokenId, picked } = usePicked(tokens);
  const [amountText, setAmountText] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);
  const balance = useReadContract({ address: monadTokens.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [user], chainId: monad.id });
  const amount = parseAmount(amountText, monadTokens.USDC.decimals);
  const tooMuch = amount !== null && balance.data !== undefined && amount > balance.data;
  const quote = useMutation({ mutationFn: () => api("withdrawQuote", { body: { user, destinationChain: chain, destinationToken: tokenId, amountRaw: amount!.toString(), recipient: recipient.trim() } }) });
  const q: WithdrawQuoteResponse | undefined = quote.data;
  const label = amount ? `${formatToken(amount, 6, 2)} USDC` : "";
  const expired = q ? q.expiresAt <= now : false;

  const send = () => {
    if (!q || !amount) return;
    void flow.runDirect({
      account: user,
      call: { address: monadTokens.USDC.address, abi: erc20Abi, functionName: "transfer", args: [q.depositAddress, amount] },
      invalidate: [balance.queryKey],
    });
  };

  if (sentId && picked) {
    return (
      <div className="squircle rounded-panel bg-surface-1 p-5 text-fg">
        <p className="mb-3 text-[15px] font-semibold">{m.deposit.status}</p>
        <TransferStatus id={sentId} kind="withdraw" chainName={picked.chainName} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Field label={m.deposit.amount} hint={balance.data !== undefined ? m.deposit.available(`${formatToken(balance.data, 6, 2)} USDC`) : undefined}>
        <span className="flex items-center gap-2">
          <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={amountText} onChange={(e) => { setAmountText(e.target.value); quote.reset(); }} className={cn(inputCls, "text-display text-[28px]")} />
          <span className="text-sm font-semibold text-ink/70">USDC</span>
        </span>
      </Field>
      <TokenPickers tokens={tokens} chain={chain} onChain={(c) => { onChain(c); quote.reset(); }} token={tokenId} onToken={(t) => { setTokenId(t); quote.reset(); }} chainLabel={m.deposit.to} />
      <Field label={m.deposit.recipient(picked?.chainName ?? "")}>
        <input autoComplete="off" spellCheck={false} placeholder="0x…" value={recipient} onChange={(e) => { setRecipient(e.target.value); quote.reset(); }} className={inputCls} />
      </Field>
      {q && (
        <div className="squircle rounded-panel bg-ink/8 px-4 py-2 text-sm">
          <p className="flex py-1">
            <span className="text-ink/70">{m.deposit.youReceive}</span>
            <span className="ml-auto font-semibold">{formatToken(q.amountOutRaw, picked?.decimals ?? 6, 2)} {picked?.symbol}</span>
          </p>
          <p className="flex py-1">
            <span className="text-ink/70">{m.deposit.time}</span>
            <span className="ml-auto font-semibold">{m.deposit.about(formatAge(q.estimatedSeconds))}</span>
          </p>
          <p className="flex py-1">
            <span className="text-ink/70">{expired ? m.deposit.expired : m.deposit.expiresIn(formatDuration(q.expiresAt - now))}</span>
          </p>
        </div>
      )}
      <p className="text-xs text-ink/65">{m.deposit.positionsNote}</p>
      {quote.isError && <p className="text-sm font-medium">{describeError(quote.error, m)}</p>}
      {!q || expired ? (
        <button onClick={() => quote.mutate()} disabled={!amount || tooMuch || !recipient.trim() || !picked || quote.isPending} className="squircle h-14 rounded-full bg-ink text-base font-semibold text-lilac transition-transform active:scale-[0.97] disabled:bg-ink/20 disabled:text-ink/50">
          {quote.isPending ? m.common.loading : m.deposit.getQuote}
        </button>
      ) : (
        <button onClick={flow.review} disabled={tooMuch} className="squircle h-14 rounded-full bg-ink text-base font-semibold text-lilac transition-transform active:scale-[0.97] disabled:bg-ink/20 disabled:text-ink/50">
          {m.deposit.sendButton(label)}
        </button>
      )}
      <TxSheet
        title={m.deposit.sendButton(label)}
        state={flow.state}
        sentences={[...m.deposit.sentencesWithdraw(label, picked?.chainName ?? ""), m.deposit.transferContract]}
        signatures={0}
        approvals={0}
        confirmLabel={m.deposit.sendButton(label)}
        onConfirm={send}
        onClose={() => {
          if (flow.state.phase === "success" && q) {
            onSent(q.id, `${label} · ${picked?.chainName}`);
            setSentId(q.id);
          }
          flow.reset();
        }}
      />
    </div>
  );
}

function Recent({ saved }: { saved: { id: string; kind: "deposit" | "withdraw"; label: string; createdAt: number }[] }) {
  const m = useT();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{m.deposit.recent}</h2>
      {saved.length === 0 ? (
        <p className="text-sm text-fg-2">{m.deposit.noRecent}</p>
      ) : (
        saved.map((t) => (
          <div key={t.id} className="squircle rounded-panel bg-surface-2">
            <button onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id} className="flex w-full items-center gap-3 px-[18px] py-3.5 text-left">
              <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-lilac font-bold text-ink">
                {t.kind === "deposit" ? "↓" : "↑"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{t.kind === "deposit" ? m.deposit.tabDeposit : m.deposit.tabWithdraw}</span>
                <span className="block truncate text-[13px] text-fg-2">{t.label}</span>
              </span>
              <span aria-hidden className="text-fg-2">{open === t.id ? "−" : "+"}</span>
            </button>
            {open === t.id && (
              <div className="px-[18px] pb-4">
                <TransferStatus id={t.id} kind={t.kind} chainName={t.label.split(" · ").pop() ?? ""} />
              </div>
            )}
          </div>
        ))
      )}
    </Card>
  );
}
