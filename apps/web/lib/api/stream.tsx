"use client";

import { signedDeviationBps } from "@levra/shared/math";
import { marketEvent, priceEvent, sessionEvent, type MarketsResponse } from "@levra/shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { endpointUrl } from "./client";
import { apiConfigured, queryKeys } from "./hooks";

/** Keeps the cached markets current from the server-sent event stream, so prices move without a reload. */
export function StreamSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!apiConfigured) return;
    const source = new EventSource(endpointUrl("/v1/stream"));
    const update = (fn: (prev: MarketsResponse) => MarketsResponse) =>
      queryClient.setQueryData<MarketsResponse>(queryKeys.markets, (prev) => (prev ? fn(prev) : prev));

    source.addEventListener("price", (e) => {
      const p = priceEvent.safeParse(JSON.parse((e as MessageEvent<string>).data));
      if (!p.success) return;
      const ev = p.data;
      update((prev) => ({
        ...prev,
        markets: prev.markets.map((m) =>
          m.symbol !== ev.symbol
            ? m
            : {
                ...m,
                oraclePriceE8: ev.oraclePriceE8,
                oracleFeedUpdatedAt: ev.feedUpdatedAt,
                oraclePublishedAt: ev.publishedAt,
                oracleStale: ev.stale,
                dexMidPriceE8: ev.dexMidPriceE8,
                dexDeviationBps: ev.dexMidPriceE8 ? signedDeviationBps(BigInt(ev.dexMidPriceE8), BigInt(ev.oraclePriceE8)) : null,
              },
        ),
      }));
    });
    source.addEventListener("market", (e) => {
      const p = marketEvent.safeParse(JSON.parse((e as MessageEvent<string>).data));
      if (!p.success) return;
      const ev = p.data;
      update((prev) => ({ ...prev, markets: prev.markets.map((m) => (m.marketId === ev.marketId ? { ...m, ...ev } : m)) }));
    });
    source.addEventListener("session", (e) => {
      const p = sessionEvent.safeParse(JSON.parse((e as MessageEvent<string>).data));
      if (!p.success) return;
      update((prev) => ({ ...prev, session: p.data }));
      queryClient.setQueryData(queryKeys.session, p.data);
    });
    return () => source.close();
  }, [queryClient]);

  return null;
}
