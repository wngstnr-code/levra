"use client";

import type { SignatureInput } from "@levra/shared/api";
import { tokens } from "@levra/shared/addresses";
import { stocks } from "@levra/shared/markets";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { apiConfigured, queryKeys, useMarkets } from "@/lib/api/hooks";
import { monad } from "@/lib/chain";
import { describeError } from "@/lib/contractErrors";
import { deployedMarket, deployment, stockOf } from "@/lib/deployment";
import { formatUsdE8 } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { guardRouterTx } from "@/lib/txGuard";
import { splitRequirements } from "@/lib/typedData";
import { formatToken, formatUsd, formatWadPercent, parseAmount, stockValueUsd } from "@/lib/units";
import { useDebounced } from "@/lib/useDebounced";
import { useNowSeconds } from "@/lib/useNow";
import { useOracleSnapshots } from "@/lib/useOracleSnapshots";
import { useQuote } from "@/lib/useQuote";
import { useTxFlow } from "@/lib/useTxFlow";
import { useSignIn } from "../SignIn";
import { TxSheet } from "../tx/TxSheet";
import { ButtonLink } from "../ui/Button";
import { TokenIcon } from "../ui/TokenIcon";
import { OrderPanel, type ActionState } from "./OrderPanel";
import { PriceCard } from "./PriceCard";
import { QuoteDetailsSheet } from "./QuoteDetailsSheet";
import { QuoteSummary } from "./QuoteSummary";


type Side = "long" | "short";
const USDC_DECIMALS = tokens.USDC.decimals;

export function TradeView() {
  const m = useT();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const symbol = stockOf(search.get("symbol") ?? "") ? search.get("symbol")! : "QQQ";
  const shortAvailable = deployedMarket(symbol, "short") !== null;
  const side: Side = search.get("side") === "short" && shortAvailable ? "short" : "long";
  const stock = stockOf(symbol)!;

  const setParams = (next: Record<string, string>) => {
    const q = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const { address } = useAccount();
  const signIn = useSignIn();
  const markets = useMarkets();
  const oracle = useOracleSnapshots();
  const market = markets.data?.markets.find((x) => x.symbol === symbol && x.side === side) ?? null;
  const snap = oracle.snapshots[symbol];

  const [marginText, setMarginText] = useState("100");
  const [leverageBySide, setLeverageBySide] = useState<Record<Side, number>>({ long: 200, short: 50 });
  const [slippageBps, setSlippageBps] = useState(50);
  const [signatures, setSignatures] = useState<SignatureInput[]>([]);
  const [details, setDetails] = useState(false);
  const flow = useTxFlow();
  const now = useNowSeconds();

  const minE2 = side === "long" ? 100 : 10;
  const maxE2 = Math.max(minE2, market?.maxLeverageE2 ?? minE2);
  const leverageE2 = Math.min(maxE2, Math.max(minE2, leverageBySide[side]));
  const marginRaw = parseAmount(marginText, USDC_DECIMALS);
  const positionUsd = marginRaw ? (marginRaw * BigInt(leverageE2)) / 100n : 0n;

  const balance = useReadContract({
    address: tokens.USDC.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: monad.id,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  // Debounced as a string, so a re-render with the same inputs never restarts the wait.
  const paramsKey = useDebounced(marginRaw && marginRaw > 0n && market ? JSON.stringify({ symbol, side, marginRaw: marginRaw.toString(), leverageE2, slippageBps }) : null);
  const params = paramsKey ? (JSON.parse(paramsKey) as { symbol: string; side: Side; marginRaw: string; leverageE2: number; slippageBps: number }) : null;
  const quote = useQuote("quoteOpen", address, params, signatures);
  const q = quote.data && params && quote.data.market.symbol === symbol && quote.data.market.side === side ? quote.data : undefined;
  const pending = q ? splitRequirements(q.requirements, signatures) : { toSign: [], toApprove: [] };
  const blocked = q?.warnings.find((w) => w.severity === "block");
  const quoteError = quote.error ? describeError(quote.error, m) : null;

  const action: ActionState = (() => {
    if (!address) return signIn ? { kind: "signIn", onClick: signIn } : { kind: "disabled", label: m.wallet.unavailable };
    if (!apiConfigured) return { kind: "disabled", label: m.trade.serviceOffline };
    if (side === "short" && !shortAvailable) return { kind: "disabled", label: m.trade.noShortMarket };
    if (!marginRaw || marginRaw === 0n) return { kind: "disabled", label: m.trade.enterAmount };
    if (balance.data !== undefined && marginRaw > balance.data) return { kind: "disabled", label: m.trade.notEnough };
    if (!q) return { kind: "disabled", label: quoteError ? m.common.notAvailable : m.trade.gettingQuote };
    if (blocked) return { kind: "disabled", label: blocked.message };
    const needsSetup = pending.toSign.length + pending.toApprove.length > 0;
    const label = side === "long" ? (needsSetup ? m.trade.signAndOpenLong : m.trade.openLong) : needsSetup ? m.trade.signAndOpenShort : m.trade.openShort;
    return { kind: "ready", label, onClick: flow.review };
  })();

  const sentences = q
    ? side === "long"
      ? m.trade.sentencesLong(`${formatToken(q.preview.debtRaw, 6, 2)} USDC`, `${formatToken(q.preview.stockAmountRaw, stock.decimals)} ${stock.tokenSymbol}`, formatUsd(q.preview.feeRaw))
      : m.trade.sentencesShort(
          `${formatToken(marginRaw ?? 0n, 6, 2)} USDC`,
          `${formatToken(q.preview.stockAmountRaw, stock.decimals)} ${stock.tokenSymbol}`,
          formatUsd(stockValueUsd(q.preview.stockAmountRaw, q.preview.execPriceE8, stock.decimals)),
        )
    : [];

  const confirm = () => {
    if (!address || !q || !market) return;
    void flow.runQuoted({
      account: address,
      requirements: q.requirements,
      signatures,
      refresh: async (sigs) => {
        setSignatures(sigs);
        return quote.refresh(sigs);
      },
      guard: (tx) => guardRouterTx(tx, { router: deployment.router, action: side === "long" ? "openLong" : "openShort", marketId: market.marketId }),
      invalidate: [queryKeys.account(address), queryKeys.history(address), queryKeys.markets],
    });
  };

  const closeFlow = () => {
    if (flow.state.phase === "success") setSignatures([]);
    flow.reset();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 pt-2 pb-4">
        <h1 className="text-display flex-1 text-[40px] leading-tight font-semibold">{m.trade.title}</h1>
        <label className="flex items-center gap-2.5 rounded-full bg-surface-1 py-1.5 pr-4 pl-1.5">
          <TokenIcon symbol={symbol} size={32} />
          <span className="sr-only">{m.trade.chooseStock}</span>
          <select
            value={symbol}
            onChange={(e) => setParams({ symbol: e.target.value, ...(deployedMarket(e.target.value, "short") ? {} : { side: "long" }) })}
            className="cursor-pointer bg-transparent text-[15px] font-semibold outline-none"
          >
            {Object.values(stocks).map((s) => (
              <option key={s.symbol} value={s.symbol} className="bg-surface-2">
                {s.tokenSymbol} · {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <PriceCard market={market} priceE8={market ? BigInt(market.oraclePriceE8) : (snap?.priceE8 ?? null)} feedUpdatedAt={market?.oracleFeedUpdatedAt ?? snap?.feedUpdatedAt ?? null} />
          <QuoteSummary
            side={side}
            market={market}
            quote={q}
            loading={quote.isFetching && !q}
            error={quoteError}
            tokenSymbol={stock.tokenSymbol}
            stockDecimals={stock.decimals}
            secondsLeft={q ? Math.max(0, q.expiresAt - now) : null}
            onDetails={() => setDetails(true)}
          />
        </div>
        <OrderPanel
          side={side}
          onSide={(s) => setParams({ side: s })}
          shortAvailable={shortAvailable}
          marginText={marginText}
          onMargin={setMarginText}
          balanceText={balance.data !== undefined ? `${formatToken(balance.data, USDC_DECIMALS, 2)} USDC` : null}
          onMax={balance.data !== undefined ? () => setMarginText(formatToken(balance.data!, USDC_DECIMALS, 2).replace(/,/g, "")) : null}
          leverageE2={leverageE2}
          onLeverage={(v) => setLeverageBySide((prev) => ({ ...prev, [side]: v }))}
          minE2={minE2}
          maxE2={maxE2}
          slippageBps={slippageBps}
          onSlippage={setSlippageBps}
          capShare={market ? Number((positionUsd * 1000n) / (BigInt(market.maxPositionUsdRaw) || 1n)) / 1000 : null}
          capText={market ? m.trade.capUse(formatUsd(positionUsd, 0), formatUsd(market.maxPositionUsdRaw, 0)) : null}
          firstTimeSignatures={pending.toSign.length}
          notes={q?.warnings.filter((w) => w.severity !== "block").map((w) => w.message) ?? []}
          action={action}
        />
      </div>

      <QuoteDetailsSheet open={details} onClose={() => setDetails(false)} quote={q} positionUsd={positionUsd} />
      <TxSheet
        title={side === "long" ? m.trade.openLong : m.trade.openShort}
        state={flow.state}
        sentences={[...sentences, m.trade.contractChecked]}
        signatures={pending.toSign.length}
        approvals={pending.toApprove.length}
        confirmLabel={action.kind === "ready" ? action.label : m.trade.openLong}
        onConfirm={confirm}
        onClose={closeFlow}
        success={
          q && (
            <div className="space-y-3">
              <div className="squircle divide-y divide-line rounded-panel bg-surface-1 text-sm">
                <p className="flex px-[18px] py-3">
                  <span className="text-fg-2">{m.trade.ltv}</span>
                  <span className="ml-auto font-medium">{formatWadPercent(q.preview.ltvAfterWad)}</span>
                </p>
                <p className="flex px-[18px] py-3">
                  <span className="text-fg-2">{m.trade.liqPrice}</span>
                  <span className="ml-auto font-medium">{formatUsdE8(BigInt(q.preview.liqPriceE8))}</span>
                </p>
              </div>
              <ButtonLink href="/positions" size="lg" className="w-full">
                {m.trade.viewPosition}
              </ButtonLink>
            </div>
          )
        }
      />
    </div>
  );
}
