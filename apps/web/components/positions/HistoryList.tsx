"use client";

import type { HistoryItem, HistoryItemType } from "@levra/shared/api";
import { useState } from "react";
import type { Address } from "viem";
import { useHistory } from "@/lib/api/hooks";
import { monad } from "@/lib/chain";
import { cn } from "@/lib/cn";
import { describeError } from "@/lib/contractErrors";
import { stockOf } from "@/lib/deployment";
import { historySentence } from "@/lib/historyText";
import { useI18n } from "@/lib/i18n";
import { formatLocal } from "@/lib/time";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Skeleton } from "../ui/Skeleton";

type Filter = "all" | "trades" | "collateral" | "protection" | "liquidations" | "earn";
const groups: Record<Exclude<Filter, "all">, HistoryItemType[]> = {
  trades: ["open", "reduce", "close", "borrow"],
  collateral: ["addCollateral", "removeCollateral", "repayDebt"],
  protection: ["autoReduce"],
  liquidations: ["liquidation"],
  earn: ["lend", "withdrawLend"],
};

const marks: Record<HistoryItemType, { glyph: string; bg: string }> = {
  open: { glyph: "↗", bg: "bg-lime" },
  reduce: { glyph: "−", bg: "bg-peri" },
  close: { glyph: "✓", bg: "bg-sage" },
  addCollateral: { glyph: "+", bg: "bg-peri" },
  removeCollateral: { glyph: "−", bg: "bg-peri" },
  repayDebt: { glyph: "↺", bg: "bg-peri" },
  borrow: { glyph: "↘", bg: "bg-peri" },
  autoReduce: { glyph: "⟲", bg: "bg-butter" },
  liquidation: { glyph: "!", bg: "bg-down" },
  lend: { glyph: "$", bg: "bg-lilac" },
  withdrawLend: { glyph: "$", bg: "bg-lilac" },
};

export function HistoryList({ address }: { address: Address }) {
  const { m, lang } = useI18n();
  const history = useHistory(address);
  const [filter, setFilter] = useState<Filter>("all");
  const items = (history.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => filter === "all" || groups[filter].includes(i.type));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(m.history.filters) as Filter[]).map((f) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={cn("rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors", filter === f ? "bg-fg text-ink" : "bg-surface-1 text-fg-2 hover:text-fg")}>
            {m.history.filters[f]}
          </button>
        ))}
      </div>
      <Card className="space-y-2 p-3">
        {history.isPending ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-panel" />)
        ) : history.isError ? (
          <p className="p-4 text-sm text-down">{describeError(history.error, m)}</p>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm text-fg-2">{m.history.empty}</p>
        ) : (
          items.map((item) => <Row key={item.id} item={item} lang={lang} />)
        )}
      </Card>
      {history.hasNextPage && (
        <Button variant="secondary" onClick={() => history.fetchNextPage()} disabled={history.isFetchingNextPage}>
          {history.isFetchingNextPage ? m.common.loading : m.history.loadMore}
        </Button>
      )}
    </div>
  );
}

function Row({ item, lang }: { item: HistoryItem; lang: string }) {
  const { m } = useI18n();
  const stock = stockOf(item.symbol);
  const mark = marks[item.type];
  return (
    <div className="squircle flex items-start gap-4 rounded-panel bg-surface-2 p-4">
      <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-full font-bold text-ink", mark.bg)}>
        {mark.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">{m.history.titles[item.type]}</span>
          <span className="rounded-full bg-surface-3 px-2.5 py-0.5 text-xs font-medium text-fg-2">
            {stock?.tokenSymbol ?? item.symbol}
            {item.side ? ` ${item.side === "long" ? m.trade.long : m.trade.short}`.toLowerCase() : ""}
          </span>
        </div>
        <p className="mt-1 text-sm text-fg-2">{historySentence(item, m)}</p>
      </div>
      <div className="shrink-0 text-right text-[13px]">
        <p className="text-fg-2">{formatLocal(item.timestamp, lang)}</p>
        <a href={`${monad.blockExplorers.default.url}/tx/${item.txHash}`} target="_blank" rel="noreferrer" className="font-medium text-lime">
          {m.common.viewTx} ↗
        </a>
      </div>
    </div>
  );
}
