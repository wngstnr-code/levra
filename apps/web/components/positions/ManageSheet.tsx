"use client";

import { morphoAbi } from "@levra/shared/abis";
import type { Position, SignatureInput } from "@levra/shared/api";
import { WAD } from "@levra/shared/math";
import { useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useReadContract } from "wagmi";
import { queryKeys } from "@/lib/api/hooks";
import { useUiMultiplier } from "@/lib/api/hooks";
import { cn } from "@/lib/cn";
import { describeError } from "@/lib/contractErrors";
import { formatUsdE8 } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { guardRouterTx } from "@/lib/txGuard";
import { splitRequirements } from "@/lib/typedData";
import { formatToken, formatUsd, formatUsdSigned, formatWadPercent, parseAmount, sharesRaw, tokenRawFromShares } from "@/lib/units";
import { useDebounced } from "@/lib/useDebounced";
import { useQuote } from "@/lib/useQuote";
import { useTxFlow } from "@/lib/useTxFlow";
import { TxSheet } from "../tx/TxSheet";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import type { ManageTab } from "./PositionCard";
import { stockOn } from "@/lib/chains";
import { useChain } from "@/lib/useChain";
import { noticeFor } from "@/lib/warnings";
import { NoticeRow } from "../ui/NoticeRow";
import { useAgentRequest } from "@/lib/useAgentRequest";
import { hasNoPrice, manageTabs, noPriceNotice } from "@/lib/marketState";

const TABS: ManageTab[] = ["add", "remove", "repay", "reduce", "close"];
const FRACTIONS = [25, 50, 75, 100];
const SLIPPAGE_BPS = 50;

export function ManageSheet({
  position,
  tab: asked,
  onTab,
  onClose,
  user,
  agentId = null,
  initialAmountRaw = null,
  initialFraction,
}: {
  position: Position;
  tab: ManageTab;
  onTab: (t: ManageTab) => void;
  onClose: () => void;
  user: Address;
  agentId?: string | null;
  initialAmountRaw?: string | null;
  initialFraction?: number;
}) {
  const noPrice = hasNoPrice(position.oraclePriceE8);
  const mult = useUiMultiplier(position.symbol);
  const { tabs, tab } = manageTabs(TABS, noPrice, asked);
  const chain = useChain();
  const m = useT();
  const flow = useTxFlow();
  const stock = stockOn(chain, position.symbol)!;
  const long = position.side === "long";
  const usdc = { address: chain.usdc.address, decimals: chain.usdc.decimals, symbol: "USDC" };
  const stk = { address: stock.token, decimals: stock.decimals, symbol: stock.tokenSymbol };
  const collateralToken = long ? stk : usdc;
  const loanToken = long ? usdc : stk;
  const amountToken = tab === "repay" ? loanToken : collateralToken;
  const isAmount = tab === "add" || tab === "remove" || tab === "repay";

  /** The stock token shows in share units on Base (uiMultiplier); USDC never does. */
  const multOf = (tok: { address: string }) => (tok.address === stk.address ? mult : null);
  const shown = (raw: string | bigint, tok: { address: string }) => sharesRaw(raw, multOf(tok));
  const prefilledRaw = initialAmountRaw && /^\d+$/.test(initialAmountRaw) ? BigInt(initialAmountRaw) : null;
  const [amountText, setAmountText] = useState(() => (prefilledRaw === null ? "" : formatUnits(shown(prefilledRaw, amountToken), amountToken.decimals)));
  const [fraction, setFraction] = useState(initialFraction ?? 50);
  const pct = tab === "close" ? 100 : fraction;
  // The link's amount is used exactly as long as the field still shows it, so rounding never changes what is quoted.
  const [prefillText] = useState(amountText);
  const fractionWad = (WAD * BigInt(Math.round(pct * 100))) / 10_000n;

  const balance = useReadContract({ address: amountToken.address, abi: erc20Abi, functionName: "balanceOf", args: [user], chainId: chain.id, query: { enabled: isAmount } });
  const typed = parseAmount(amountText, amountToken.decimals);
  const availableRaw = tab === "remove" ? BigInt(position.collateralRaw) : tab === "repay" ? BigInt(position.debtRaw) : (balance.data ?? null);
  const amountRaw =
    prefilledRaw !== null && prefillText !== "" && amountText === prefillText
      ? prefilledRaw
      : typed === null
        ? null
        : typed === (availableRaw === null ? null : shown(availableRaw, amountToken))
          ? availableRaw
          : tokenRawFromShares(typed, multOf(amountToken));
  const agent = useAgentRequest(agentId, user, (p) => {
    if (p.kind === "open" || p.request.marketId.toLowerCase() !== position.marketId.toLowerCase()) return false;
    if (p.kind === "close") return !isAmount && BigInt(p.request.fractionWad) === fractionWad;
    return p.request.action === tab && amountRaw !== null && BigInt(p.request.amountRaw) === amountRaw;
  });

  const available = availableRaw;

  const collKey = useDebounced(isAmount && amountRaw && amountRaw > 0n ? JSON.stringify({ marketId: position.marketId, action: tab, amountRaw: amountRaw.toString() }) : null);
  const closeKey = !isAmount ? JSON.stringify({ marketId: position.marketId, fractionWad: fractionWad.toString(), slippageBps: SLIPPAGE_BPS }) : null;
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

  const amountLabel = amountRaw ? `${formatToken(shown(amountRaw, amountToken), amountToken.decimals, amountToken.decimals === 6 ? 2 : 4)} ${amountToken.symbol}` : "";
  const confirmLabel = isAmount ? m.positions.confirm[tab as "add" | "remove" | "repay"](amountLabel) : tab === "close" ? m.positions.confirm.close : m.positions.confirm.reduce(`${pct}%`);
  const sentences = isAmount
    ? m.positions.sentences[tab as "add" | "remove" | "repay"](amountLabel)
    : close.data
      ? m.positions.sentences.reduce(
          `${formatToken(sharesRaw(close.data.preview.stockAmountRaw, mult), stock.decimals)} ${stock.tokenSymbol}`,
          formatToken(shown(close.data.preview.debtRepaidRaw, loanToken), loanToken.decimals, loanToken.decimals === 6 ? 2 : 4) + ` ${loanToken.symbol}`,
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
      guard: (tx) => guardRouterTx(tx, { router: chain.deployment.router, action, marketId: position.marketId }),
      invalidate: [queryKeys.account(user), queryKeys.history(user)],
    });
  };

  const authorize = () =>
    void flow.runDirect({
      account: user,
      call: { address: chain.morpho, abi: morphoAbi, functionName: "setAuthorization", args: [chain.deployment.router, true] },
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
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => {
              if (t !== tab) setAmountText("");
              onTab(t);
            }} className={cn("flex-1 rounded-full py-2 text-sm font-medium transition-colors", tab === t ? "bg-surface-3 font-semibold" : "text-fg-2 hover:text-fg")}>
              {m.positions.tabs[t]}
            </button>
          ))}
        </div>
        {agent && <NoticeRow notice={{ icon: "verified", blocks: false, title: m.agent.title, body: m.agent.body }} />}
        {noPrice && <NoticeRow notice={noPriceNotice(m)} />}

        {isAmount ? (
          <label className="squircle block rounded-panel bg-surface-1 p-5">
            <span className="label-caps">{m.positions.amount}</span>
            <span className="mt-2 flex items-center gap-2">
              <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="text-display w-full min-w-0 bg-transparent text-[32px] font-semibold outline-none placeholder:text-fg-3" />
              <span className="shrink-0 text-sm font-semibold text-fg-2">{amountToken.symbol}</span>
            </span>
            {available !== null && (
              <span className="mt-2 flex text-[13px] text-fg-2">
                {tab === "add" ? m.positions.inWallet(formatToken(shown(available, amountToken), amountToken.decimals, 4)) : `${formatToken(shown(available, amountToken), amountToken.decimals, 4)} ${amountToken.symbol}`}
                <button type="button" onClick={() => setAmountText(formatToken(shown(available, amountToken), amountToken.decimals, amountToken.decimals).replace(/,/g, ""))} className="ml-1.5 font-semibold text-lime">
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
              <Line k={m.positions.collateralAfter} v={`${formatToken(shown(coll.data.preview.collateralAfterRaw, collateralToken), collateralToken.decimals, 4)} ${collateralToken.symbol}`} />
              <Line k={m.positions.ltvAfter} v={formatWadPercent(coll.data.preview.ltvAfterWad)} />
              <Line k={m.positions.liqAfter} v={formatUsdE8(BigInt(coll.data.preview.liqPriceE8))} />
            </>
          ) : !isAmount && close.data ? (
            <>
              <Line k={long ? m.positions.sold : m.positions.boughtBack} v={`${formatToken(sharesRaw(close.data.preview.stockAmountRaw, mult), stock.decimals)} ${stock.tokenSymbol} · ${formatUsdE8(BigInt(close.data.preview.execPriceE8))}`} />
              <Line k={m.positions.repaid} v={`${formatToken(shown(close.data.preview.debtRepaidRaw, loanToken), loanToken.decimals, 4)} ${loanToken.symbol}`} />
              <Line k={m.positions.withdrawn} v={`${formatToken(shown(close.data.preview.collateralWithdrawnRaw, collateralToken), collateralToken.decimals, 4)} ${collateralToken.symbol}`} />
              <Line k={m.positions.youReceive} v={formatUsd(close.data.preview.returnedRaw)} />
              {!long && BigInt(close.data.preview.stockAmountRaw) > BigInt(close.data.preview.debtRepaidRaw) && (
                <Line k={m.positions.stockBack} v={`${formatToken(sharesRaw(BigInt(close.data.preview.stockAmountRaw) - BigInt(close.data.preview.debtRepaidRaw), mult), stock.decimals)} ${stock.tokenSymbol}`} />
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
          <NoticeRow key={w.code} notice={noticeFor(w, m)} />
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
