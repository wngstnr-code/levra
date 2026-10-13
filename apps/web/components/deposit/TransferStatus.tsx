"use client";

import type { DepositStatus } from "@levra/shared/api";
import { useDepositStatus } from "@/lib/api/hooks";
import { monad } from "@/lib/chain";
import { cn } from "@/lib/cn";
import { describeError } from "@/lib/contractErrors";
import { useT } from "@/lib/i18n";
import { formatToken } from "@/lib/units";
import { ButtonLink } from "../ui/Button";

type State = DepositStatus["status"];
const rank: Record<State, number> = { WAITING: 0, PROCESSING: 1, SUCCESS: 2, REFUNDED: 2, FAILED: 2, EXPIRED: 2 };

// What arrives on Monad: USDC for a deposit, MON (wei) for the network fee transfer of D-40.
const ARRIVES = { USDC: { decimals: 6, digits: 2 }, MON: { decimals: 18, digits: 4 } } as const;

/** Follows one transfer: seen, processing, arrived, or how it ended. */
export function TransferStatus({ id, kind, chainName, arrives = "USDC" }: { id: string; kind: "deposit" | "withdraw"; chainName: string; arrives?: keyof typeof ARRIVES }) {
  const m = useT();
  const status = useDepositStatus(id);
  const s = status.data;
  const r = s ? rank[s.status] : -1;
  const bad = s && (s.status === "REFUNDED" || s.status === "FAILED" || s.status === "EXPIRED");
  const steps =
    kind === "deposit"
      ? [m.deposit.stepSeen, m.deposit.stepProcessing, m.deposit.stepArrived]
      : [m.deposit.stepSent, m.deposit.stepProcessing, m.deposit.stepArrivedOn(chainName)];
  return (
    <div className="space-y-3.5">
      {status.isError && <p className="text-sm text-down">{describeError(status.error, m)}</p>}
      {s && (
        <p className={cn("text-[15px] font-semibold", bad ? "text-down" : s.status === "SUCCESS" ? "text-up" : "text-fg")}>
          {m.deposit.states[s.status]} · <span className="font-normal text-fg-2">{m.deposit.stateBody[s.status]}</span>
        </p>
      )}
      <ol className="space-y-3">
        {steps.map((label, i) => {
          const done = r > i || (s?.status === "SUCCESS" && i <= 2);
          const now = !bad && r === i && s?.status !== "SUCCESS";
          return (
            <li key={label} className="flex items-start gap-3">
              <span aria-hidden className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", done ? "bg-lilac text-ink" : now ? "bg-surface-3 ring-2 ring-lilac" : "bg-surface-2")}>
                {done ? "✓" : ""}
              </span>
              <div>
                <p className={cn("text-[15px] font-medium", !done && !now && "text-fg-3")}>{label}</p>
                {i === 0 && s?.originTxHash && <p className="text-[13px] break-all text-fg-2">{s.originTxHash}</p>}
                {i === 1 && now && <p className="text-[13px] text-fg-2">{m.deposit.usually}</p>}
                {i === 2 && s?.destinationTxHash && kind === "deposit" && (
                  <a href={`${monad.blockExplorers.default.url}/tx/${s.destinationTxHash}`} target="_blank" rel="noreferrer" className="text-[13px] text-lilac">
                    {s.amountOutRaw ? `${formatToken(s.amountOutRaw, ARRIVES[arrives].decimals, ARRIVES[arrives].digits)} ${arrives} · ` : ""}
                    {m.common.viewTx} ↗
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {s?.status === "SUCCESS" && kind === "deposit" && (
        <ButtonLink href="/trade" className="w-full">
          {m.deposit.goTrade}
        </ButtonLink>
      )}
      <p className="text-xs text-fg-3">{m.deposit.id(id)}</p>
    </div>
  );
}
