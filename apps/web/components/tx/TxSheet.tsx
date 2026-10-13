"use client";

import { monad } from "@/lib/chain";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { FlowState } from "@/lib/useTxFlow";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

type Props = {
  title: string;
  state: FlowState;
  /** What the transaction does, in plain sentences, shown before the wallet opens. */
  sentences: string[];
  /** Number of free signatures and approval transactions the action still needs. */
  signatures: number;
  approvals: number;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  success?: React.ReactNode;
};

export function TxSheet({ title, state, sentences, signatures, approvals, confirmLabel, onConfirm, onClose, success }: Props) {
  const m = useT();
  const open = state.phase !== "idle";
  const busy = state.phase === "signing" || state.phase === "approving" || state.phase === "wallet" || state.phase === "pending";
  const explorer = state.hash ? `${monad.blockExplorers.default.url}/tx/${state.hash}` : null;

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={state.phase === "success" ? m.tx.successTitle : state.phase === "error" ? m.tx.errorTitle : title}>
      {(state.phase === "review" || busy) && (
        <>
          <div className="squircle rounded-panel bg-surface-1 p-5">
            <p className="text-sm text-fg-2">{m.tx.youApprove}</p>
            <ul className="mt-3 space-y-2">
              {sentences.map((s) => (
                <li key={s} className="flex gap-2.5 text-[15px]">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-lime" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <ol className="space-y-3">
            {signatures > 0 && <Step state={stepState(state, "signing", 0)} title={m.tx.signTitle(signatures)} sub={m.tx.signSub} />}
            {approvals > 0 && <Step state={stepState(state, "approving", 1)} title={m.tx.approveTitle} sub={m.tx.approveSub} />}
            <Step state={state.phase === "wallet" ? "now" : state.phase === "pending" ? "done" : "todo"} title={m.tx.confirmTitle} sub={state.phase === "wallet" ? m.tx.waitingWallet : m.tx.confirmSub} />
            <Step state={state.phase === "pending" ? "now" : "todo"} title={m.tx.pendingTitle} sub={explorer ? <a href={explorer} target="_blank" rel="noreferrer" className="text-lime">{m.common.viewTx} ↗</a> : m.tx.pendingSub} />
          </ol>
          <Button size="lg" className="w-full" onClick={onConfirm} disabled={busy}>
            {busy ? m.tx.inProgress : confirmLabel}
          </Button>
        </>
      )}
      {state.phase === "success" && (
        <>
          <div className="squircle flex items-center gap-4 rounded-panel bg-sage p-5 text-ink">
            <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-ink text-xl text-sage">✓</span>
            <p className="text-[15px] font-semibold">{m.tx.successBody}</p>
          </div>
          {success}
          {explorer && (
            <a href={explorer} target="_blank" rel="noreferrer" className="text-sm font-medium text-lime">
              {m.common.viewTx} ↗
            </a>
          )}
          <Button size="lg" variant="secondary" className="w-full" onClick={onClose}>
            {m.common.done}
          </Button>
        </>
      )}
      {state.phase === "error" && (
        <>
          <div className="squircle flex items-start gap-4 rounded-panel bg-surface-1 p-5">
            <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-down text-xl font-bold text-ink">×</span>
            <p className="text-[15px] text-fg">{state.error}</p>
          </div>
          {explorer && (
            <a href={explorer} target="_blank" rel="noreferrer" className="text-sm font-medium text-lime">
              {m.common.viewTx} ↗
            </a>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="secondary" onClick={onClose}>
              {m.common.close}
            </Button>
            <Button size="lg" onClick={onConfirm}>
              {m.common.tryAgain}
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function stepState(state: FlowState, phase: "signing" | "approving", order: number): "done" | "now" | "todo" {
  if (state.phase === phase) return "now";
  const rank = { review: -1, signing: 0, approving: 1, wallet: 2, pending: 3 } as Record<string, number>;
  return (rank[state.phase] ?? -1) > order ? "done" : "todo";
}

function Step({ state, title, sub }: { state: "done" | "now" | "todo"; title: string; sub: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          state === "done" ? "bg-lime text-ink" : state === "now" ? "bg-surface-3 ring-2 ring-lime" : "bg-surface-3",
        )}
      >
        {state === "done" ? "✓" : ""}
      </span>
      <div>
        <p className={cn("text-[15px] font-medium", state === "todo" && "text-fg-3", state === "now" && "font-semibold")}>{title}</p>
        <p className="text-[13px] text-fg-2">{sub}</p>
      </div>
    </li>
  );
}
