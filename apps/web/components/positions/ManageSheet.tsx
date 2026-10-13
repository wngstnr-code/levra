"use client";

import { morphoAbi } from "@levra/shared/abis";
import { external, tokens } from "@levra/shared/addresses";
import type { Position, SignatureInput } from "@levra/shared/api";
import { WAD } from "@levra/shared/math";
import { useState } from "react";
import { erc20Abi, type Address } from "viem";
import { useReadContract } from "wagmi";
import { queryKeys } from "@/lib/api/hooks";
import { monad } from "@/lib/chain";
import { cn } from "@/lib/cn";
import { describeError } from "@/lib/contractErrors";
import { deployment, stockOf } from "@/lib/deployment";
import { formatUsdE8 } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { guardRouterTx } from "@/lib/txGuard";
import { splitRequirements } from "@/lib/typedData";
import { formatToken, formatUsd, formatUsdSigned, formatWadPercent, parseAmount } from "@/lib/units";
import { useDebounced } from "@/lib/useDebounced";
import { useQuote } from "@/lib/useQuote";
import { useTxFlow } from "@/lib/useTxFlow";
import { TxSheet } from "../tx/TxSheet";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import type { ManageTab } from "./PositionCard";

const TABS: ManageTab[] = ["add", "remove", "repay", "reduce", "close"];
const FRACTIONS = [25, 50, 75, 100];
const SLIPPAGE_BPS = 50;

export function ManageSheet({ position, tab, onTab, onClose, user }: { position: Position; tab: ManageTab; onTab: (t: ManageTab) => void; onClose: () => void; user: Address }) {
  const m = useT();
  const flow = useTxFlow();
  const stock = stockOf(position.symbol)!;
  const long = position.side === "long";
  const usdc = { address: tokens.USDC.address, decimals: tokens.USDC.decimals, symbol: "USDC" };
  const stk = { address: stock.token, decimals: stock.decimals, symbol: stock.tokenSymbol };
  const collateralToken = long ? stk : usdc;
  const loanToken = long ? usdc : stk;
  const amountToken = tab === "repay" ? loanToken : collateralToken;
  const isAmount = tab === "add" || tab === "remove" || tab === "repay";

  const [amountText, setAmountText] = useState("");
  const [fraction, setFraction] = useState(50);
  const pct = tab === "close" ? 100 : fraction;
  const amountRaw = parseAmount(amountText, amountToken.decimals);

  const balance = useReadContract({ address: amountToken.address, abi: erc20Abi, functionName: "balanceOf", args: [user], chainId: monad.id, query: { enabled: isAmount } });
  const available = tab === "remove" ? BigInt(position.collateralRaw) : tab === "repay" ? BigInt(position.debtRaw) : (balance.data ?? null);

  const collKey = useDebounced(isAmount && amountRaw && amountRaw > 0n ? JSON.stringify({ marketId: position.marketId, action: tab, amountRaw: amountRaw.toString() }) : null);
  const closeKey = !isAmount ? JSON.stringify({ marketId: position.marketId, fractionWad: ((WAD * BigInt(pct)) / 100n).toString(), slippageBps: SLIPPAGE_BPS }) : null;
  const [signatures, setSignatures] = useState<SignatureInput[]>([]);
  const coll = useQuote("quoteCollateral", user, collKey ? JSON.parse(collKey) : null, signatures);
  const close = useQuote("quoteClose", user, closeKey ? JSON.parse(closeKey) : null);

  const quote = isAmount ? coll.data : close.data;
  const error = (isAmount ? coll.error : close.error) ?? null;
  const needsAuth = !isAmount && !!close.data?.requirements.some((r) => r.type === "morphoAuthorization" && !r.satisfied);
  const requirements = (quote?.requirements ?? []).filter((r) => isAmount || r.type !== "morphoAuthorization");
  const pending = splitRequirements(requirements, signatures);
  const blocked = quote?.warnings.find((w) => w.severity === "block");
  const tooMuch = isAmount && amountRaw !== null && available !== null && amountRaw > available;

  const amountLabel = amountRaw ? `${formatToken(amountRaw, amountToken.decimals, amountToken.decimals === 6 ? 2 : 4)} ${amountToken.symbol}` : "";
  const confirmLabel = isAmount ? m.positions.confirm[tab as "add" | "remove" | "repay"](amountLabel) : tab === "close" ? m.positions.confirm.close : m.positions.confirm.reduce(`${pct}%`);
  const sentences = isAmount
    ? m.positions.sentences[tab as "add" | "remove" | "repay"](amountLabel)
    : close.data
      ? m.positions.sentences.reduce(
          `${formatToken(close.data.preview.stockAmountRaw, stock.decimals)} ${stock.tokenSymbol}`,
          formatToken(close.data.preview.debtRepaidRaw, loanToken.decimals, loanToken.decimals === 6 ? 2 : 4) + ` ${loanToken.symbol}`,
          formatUsd(close.data.preview.returnedRaw),
        )
      : [];

  const action = isAmount ? ({ add: "addCollateral", remove: "removeCollateral", repay: "repayDebt" } as const)[tab as "add" | "remove" | "repay"] : long ? "closeLong" : "closeShort";

  const confirm = () => {
    if (!quote) return;
    void flow.runQuoted({
      account: user,
      requirements,
      signatures,
      refresh: async (sigs) => {
        setSignatures(sigs);
        return isAmount ? coll.refresh(sigs) : close.refresh([]);
      },
      guard: (tx) => guardRouterTx(tx, { router: deployment.router, action, marketId: position.marketId }),
      invalidate: [queryKeys.account(user), queryKeys.history(user)],
    });
  };

  const authorize = () =>
    void flow.runDirect({
      account: user,
      call: { address: external.morpho, abi: morphoAbi, functionName: "setAuthorization", args: [deployment.router, true] },
      invalidate: [queryKeys.account(user)],
    });

  const done = () => {
    const ok = flow.state.phase === "success";
    flow.reset();
    if (ok) onClose();
  };

  return (
    <>
      <Sheet open={flow.state.phase === "idle"} onClose={onClose} title={m.positions.manageTitle(stock.tokenSymbol, long ? m.trade.long : m.trade.short)}>
        <div role="tablist" className="flex gap-1 rounded-full bg-surface-1 p-1">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => onTab(t)} className={cn("flex-1 rounded-full py-2 text-sm font-medium transition-colors", tab === t ? "bg-surface-3 font-semibold" : "text-fg-2 hover:text-fg")}>
              {m.positions.tabs[t]}
            </button>
          ))}
        </div>

        {isAmount ? (
          <label className="squircle block rounded-panel bg-surface-1 p-5">
            <span className="label-caps">{m.positions.amount}</span>
            <span className="mt-2 flex items-center gap-2">
              <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="text-display w-full min-w-0 bg-transparent text-[32px] font-semibold outline-none placeholder:text-fg-3" />
              <span className="shrink-0 text-sm font-semibold text-fg-2">{amountToken.symbol}</span>
            </span>
            {available !== null && (
              <span className="mt-2 flex text-[13px] text-fg-2">
                {tab === "add" ? m.positions.inWallet(formatToken(available, amountToken.decimals, 4)) : `${formatToken(available, amountToken.decimals, 4)} ${amountToken.symbol}`}
                <button type="button" onClick={() => setAmountText(formatToken(available, amountToken.decimals, amountToken.decimals).replace(/,/g, ""))} className="ml-1.5 font-semibold text-lime">
                  {m.common.max}
                </button>
              </span>
            )}
          </label>
        ) : (
          <div className="space-y-3">
            <p className="text-center">
              <span className="font-rounded block text-[56px] leading-none font-semibold">{pct}%</span>
              <span className="text-sm text-fg-2">{m.positions.ofPosition}</span>
            </p>
            {tab === "reduce" && (
              <div className="flex gap-2">
                {FRACTIONS.map((f) => (
                  <button key={f} aria-pressed={fraction === f} onClick={() => setFraction(f)} className={cn("flex-1 rounded-full py-2 text-sm font-semibold transition-colors", fraction === f ? "bg-lime text-ink" : "bg-surface-3")}>
                    {f}%
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="squircle divide-y divide-line rounded-panel bg-surface-1 text-sm">
          {isAmount && coll.data ? (
            <>
              <Line k={m.positions.collateralAfter} v={`${formatToken(coll.data.preview.collateralAfterRaw, collateralToken.decimals, 4)} ${collateralToken.symbol}`} />
              <Line k={m.positions.ltvAfter} v={formatWadPercent(coll.data.preview.ltvAfterWad)} />
              <Line k={m.positions.liqAfter} v={formatUsdE8(BigInt(coll.data.preview.liqPriceE8))} />
            </>
          ) : !isAmount && close.data ? (
            <>
              <Line k={long ? m.positions.sold : m.positions.boughtBack} v={`${formatToken(close.data.preview.stockAmountRaw, stock.decimals)} ${stock.tokenSymbol} · ${formatUsdE8(BigInt(close.data.preview.execPriceE8))}`} />
              <Line k={m.positions.repaid} v={`${formatToken(close.data.preview.debtRepaidRaw, loanToken.decimals, 4)} ${loanToken.symbol}`} />
              <Line k={m.positions.withdrawn} v={`${formatToken(close.data.preview.collateralWithdrawnRaw, collateralToken.decimals, 4)} ${collateralToken.symbol}`} />
              <Line k={m.positions.youReceive} v={formatUsd(close.data.preview.returnedRaw)} />
              {!long && BigInt(close.data.preview.stockAmountRaw) > BigInt(close.data.preview.debtRepaidRaw) && (
                <Line k={m.positions.stockBack} v={`${formatToken(BigInt(close.data.preview.stockAmountRaw) - BigInt(close.data.preview.debtRepaidRaw), stock.decimals)} ${stock.tokenSymbol}`} />
              )}
              <Line k={m.positions.realized} v={formatUsdSigned(close.data.preview.realizedPnlUsdRaw)} tone={BigInt(close.data.preview.realizedPnlUsdRaw) < 0n ? "text-down" : "text-up"} />
              <Line k={m.positions.fee} v={formatUsd(close.data.preview.feeRaw)} />
              {tab === "reduce" && <Line k={m.positions.ltvAfter} v={formatWadPercent(close.data.preview.ltvAfterWad)} />}
            </>
          ) : (
            <p className="px-[18px] py-4 text-fg-2">{error ? describeError(error, m) : isAmount ? m.trade.emptySummary : m.common.loading}</p>
          )}
        </div>

        {quote?.warnings.map((w) => (
          <p key={w.code} className={cn("text-[13px]", w.severity === "block" ? "text-down" : "text-caution")}>
            {w.message}
          </p>
        ))}
        <p className="text-xs text-fg-3">{m.positions.neverPaused}</p>

        {needsAuth ? (
          <>
            <p className="text-sm text-caution">{m.positions.authorizeFirst}</p>
            <Button size="lg" onClick={authorize}>
              {m.positions.authorize}
            </Button>
          </>
        ) : (
          <Button size="lg" onClick={flow.review} disabled={!quote || !!blocked || tooMuch}>
            {confirmLabel}
          </Button>
        )}
      </Sheet>
      <TxSheet
        title={confirmLabel}
        state={flow.state}
        sentences={[...sentences, m.trade.contractChecked]}
        signatures={pending.toSign.length}
        approvals={pending.toApprove.length}
        confirmLabel={needsAuth ? m.positions.authorize : confirmLabel}
        onConfirm={needsAuth ? authorize : confirm}
        onClose={done}
      />
    </>
  );
}

function Line({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <p className="flex gap-3 px-[18px] py-3">
      <span className="text-fg-2">{k}</span>
      <span className={cn("ml-auto text-right font-medium tabular-nums", tone)}>{v}</span>
    </p>
  );
}
