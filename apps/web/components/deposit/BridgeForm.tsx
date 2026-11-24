"use client";

import type { BridgePlan } from "@levra/shared/api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { erc20Abi, type Address, type Hex } from "viem";
import { useConfig, useReadContract } from "wagmi";
import { api } from "@/lib/api/client";
import { useBridgeChains } from "@/lib/api/hooks";
import { bridgeViemChain } from "@/lib/bridgeChains";
import { bridgeDone, checkBridgePlan, loadBurn, runBridgePlan, runManualMint, saveBurn, UnsafePlanError, type BridgeStep } from "@/lib/bridgeTransfer";
import { cn } from "@/lib/cn";
import { describeError } from "@/lib/contractErrors";
import { useT } from "@/lib/i18n";
import { formatDuration, formatToken, parseAmount } from "@/lib/units";
import { useChain } from "@/lib/useChain";
import { useNowSeconds } from "@/lib/useNow";
import { useGatedAction } from "../gate/Compliance";
import { Skeleton } from "../ui/Skeleton";

const MIN_RAW = 1_000_000n;
/** USDC has 6 decimals on every CCTP chain. */
const USDC_DECIMALS = 6;
/** After this long without Circle seeing the burn, say so and point at the transaction. */
const SLOW_SECONDS = 15 * 60;

function explorerTx(chainId: number, hash: Hex): string | null {
  const url = bridgeViemChain(chainId)?.blockExplorers?.default.url;
  return url ? `${url}/tx/${hash}` : null;
}

/** USDC into this chain from another one (deposit), or out of it (withdraw), through Circle CCTP (BE-85). */
export function BridgeForm({ user, direction }: { user: Address; direction: "deposit" | "withdraw" }) {
  const m = useT();
  const b = m.bridge;
  const chain = useChain();
  const config = useConfig();
  const now = useNowSeconds();
  const chains = useBridgeChains();
  const options = (chains.data?.chains ?? []).filter((c) => c.chainId !== chain.id && bridgeViemChain(c.chainId));
  const [otherId, setOtherId] = useState<number | null>(null);
  const other = options.find((c) => c.chainId === otherId) ?? options.find((c) => c.chainId !== chain.id) ?? null;
  const [amountText, setAmountText] = useState("");
  const amount = parseAmount(amountText, USDC_DECIMALS);
  const [step, setStep] = useState<BridgeStep | null>(null);
  // Only rendered with a connected wallet, so on the client: the saved burn can be read on the first render.
  const [burn, setBurnState] = useState<{ hash: Hex; plan: BridgePlan; at: number } | null>(() => loadBurn(user));
  const setBurn = (b: { hash: Hex; plan: BridgePlan; at: number } | null) => {
    setBurnState(b);
    saveBurn(user, b);
  };
  const gated = useGatedAction();

  const fromChainId = direction === "deposit" ? other?.chainId : chain.id;
  const fromUsdc = direction === "deposit" ? other?.usdc : chain.usdc.address;
  const balance = useReadContract({ address: fromUsdc, abi: erc20Abi, functionName: "balanceOf", args: [user], chainId: fromChainId, query: { enabled: !!fromUsdc && !!fromChainId } });
  const tooSmall = amount !== null && amount < MIN_RAW;
  const tooMuch = amount !== null && balance.data !== undefined && amount > balance.data;

  const plan = useMutation({
    mutationFn: () =>
      direction === "deposit"
        ? api("bridgeDeposit", { chainId: chain.id, body: { fromChainId: other!.chainId, amountRaw: amount!.toString(), recipient: user } })
        : api("bridgeWithdraw", { chainId: chain.id, body: { toChainId: other!.chainId, amountRaw: amount!.toString(), user, recipient: user } }),
  });
  const send = useMutation({
    mutationFn: async (p: BridgePlan) => {
      checkBridgePlan(p, { fromChainId: fromChainId!, toChainId: direction === "deposit" ? chain.id : other!.chainId, amountRaw: amount!, recipient: user });
      return { hash: await runBridgePlan(config, user, p, setStep), plan: p, at: now };
    },
    onSuccess: (r) => setBurn(r),
    onSettled: () => setStep(null),
  });
  const status = useQuery({
    queryKey: ["bridgeStatus", burn?.hash],
    queryFn: ({ signal }) => api("bridgeStatus", { query: { fromChainId: String(burn!.plan.fromChainId), txHash: burn!.hash }, signal }),
    enabled: !!burn,
    refetchInterval: (q) => (bridgeDone(q.state.data?.state) ? false : 5_000),
  });
  const mint = useMutation({ mutationFn: () => runManualMint(config, user, burn!.plan.toChainId, status.data!.manualMint!), onSuccess: () => void status.refetch() });

  const reset = () => {
    setBurn(null);
    plan.reset();
    send.reset();
    mint.reset();
    setAmountText("");
  };

  if (chains.isPending) return <Skeleton className="h-56 w-full rounded-panel bg-ink/10" />;
  if (chains.isError) return <p className="text-sm">{describeError(chains.error, m)}</p>;

  if (burn) {
    const s = status.data;
    const burnUrl = explorerTx(burn.plan.fromChainId, burn.hash);
    const mintUrl = s?.mintTxHash ? explorerTx(burn.plan.toChainId, s.mintTxHash as Hex) : null;
    return (
      <div className="flex flex-col gap-3.5" role="status">
        <p className="text-xs font-semibold tracking-wide text-ink/60 uppercase">{m.deposit.status}</p>
        <p className="text-display text-[26px] leading-tight font-semibold">{s ? (s.state === "COMPLETE" && s.receivedRaw ? b.received(formatToken(s.receivedRaw, USDC_DECIMALS, 2)) : b.states[s.state]) : b.states.NOT_FOUND}</p>
        {s?.delayReason && <p className="text-sm text-ink/70">{b.delayed(s.delayReason)}</p>}
        {status.isError && <p className="text-sm">{describeError(status.error, m)}</p>}
        {(!s || s.state === "NOT_FOUND") && now - burn.at > SLOW_SECONDS && <p className="text-sm text-ink/70">{b.slow}</p>}
        {mint.isSuccess && s?.state === "FAILED" && <p className="text-sm text-ink/70">{b.mintSent}</p>}
        {s?.state === "FAILED" && s.manualMint && (
          <div className="squircle space-y-2 rounded-panel bg-ink/8 p-4">
            <p className="text-sm">{b.manualMintBody}</p>
            <button onClick={() => mint.mutate()} disabled={mint.isPending || mint.isSuccess} className="squircle h-12 w-full rounded-full bg-ink text-[15px] font-semibold text-lilac disabled:opacity-40">
              {b.manualMint}
            </button>
            {mint.isError && <p className="text-sm">{describeError(mint.error, m)}</p>}
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-sm font-semibold">
          {burnUrl && (
            <a href={burnUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
              {b.viewBurn} ↗
            </a>
          )}
          {mintUrl && (
            <a href={mintUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
              {b.viewMint} ↗
            </a>
          )}
        </div>
        {bridgeDone(s?.state) && (
          <button onClick={reset} className="text-left text-sm font-semibold underline-offset-2 hover:underline">
            {b.newTransfer}
          </button>
        )}
      </div>
    );
  }

  const p = plan.data;
  if (p) {
    const busy = send.isPending;
    return (
      <div className="flex flex-col gap-3.5">
        <p className="text-xs font-semibold tracking-wide text-ink/60 uppercase">{b.youReceive}</p>
        <p className="text-display text-[32px] leading-none font-semibold">{formatToken(p.minReceivedRaw, USDC_DECIMALS, 2)} USDC</p>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink/60">{b.maxFee}</dt>
            <dd className="font-semibold">{formatToken(p.maxFeeRaw, USDC_DECIMALS, 2)} USDC</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink/60">{b.time}</dt>
            <dd className="font-semibold">{b.about(formatDuration(p.estimatedSeconds))}</dd>
          </div>
        </dl>
        <p className="text-[13px] text-ink/70">{b.how}</p>
        {step && <p className="text-sm font-semibold">{b.steps[step]}</p>}
        {send.isError && <p className="text-sm">{send.error instanceof UnsafePlanError ? b.unsafe : describeError(send.error, m)}</p>}
        <button onClick={() => send.mutate(p)} disabled={busy} className="squircle h-14 rounded-full bg-ink text-base font-semibold text-lilac disabled:opacity-40">
          {b.send}
        </button>
        <button onClick={() => plan.reset()} disabled={busy} className="text-sm font-semibold underline-offset-2 hover:underline disabled:opacity-40">
          {b.edit}
        </button>
      </div>
    );
  }

  const canPlan = !!other && amount !== null && amount > 0n && !tooSmall && !tooMuch && !plan.isPending;
  const action = direction === "deposit" ? gated : null;
  return (
    <div className="flex flex-col gap-3.5">
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold tracking-wide text-ink/60 uppercase">{direction === "deposit" ? b.fromNetwork : b.toNetwork}</span>
        <select value={other?.chainId ?? ""} onChange={(e) => setOtherId(Number(e.target.value))} className="squircle h-12 w-full rounded-panel bg-ink/8 px-4 text-[15px] font-semibold outline-none">
          {options.map((c) => (
            <option key={c.chainId} value={c.chainId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold tracking-wide text-ink/60 uppercase">{m.deposit.amount}</span>
        <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="squircle h-14 w-full rounded-panel bg-ink/8 px-4 text-[22px] font-semibold outline-none placeholder:text-ink/30" />
        <span className={cn("block text-[13px]", tooSmall || tooMuch ? "font-semibold" : "text-ink/60")}>
          {tooSmall ? b.minimum : tooMuch ? b.overBalance(formatToken(balance.data!, USDC_DECIMALS, 2)) : balance.data !== undefined ? b.balance(formatToken(balance.data, USDC_DECIMALS, 2)) : b.minimum}
        </span>
      </label>
      {plan.isError && <p className="text-sm">{describeError(plan.error, m)}</p>}
      <button
        onClick={action?.onClick ?? (() => plan.mutate())}
        disabled={action ? !action.onClick : !canPlan}
        className="squircle h-14 rounded-full bg-ink text-base font-semibold text-lilac disabled:opacity-40"
      >
        {action?.label ?? (plan.isPending ? b.gettingPlan : b.getPlan)}
      </button>
    </div>
  );
}
