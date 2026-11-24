"use client";

import { ApiRequestError } from "@/lib/api/client";
import { apiConfigured, useMarkets, useServiceStatus } from "@/lib/api/hooks";
import { stockOn } from "@/lib/chains";
import { useChain } from "@/lib/useChain";
import { useT } from "@/lib/i18n";
import { serviceHealth } from "@/lib/serviceHealth";
import { Banner } from "./ui/Banner";

/** Page-wide notices that must always be visible: no service, a stale price, background services behind. */
export function StatusBanners() {
  const m = useT();
  const status = useServiceStatus();
  const chain = useChain();
  const markets = useMarkets();

  if (!apiConfigured) {
    return (
      <Banner tone="info" title={m.status.offlineTitle}>
        {m.status.offlineBody}
      </Banner>
    );
  }
  if (status.isError && status.error instanceof ApiRequestError && (status.error.code === "NETWORK" || (status.error.status ?? 0) >= 500)) {
    return (
      <Banner tone="caution" title={m.status.offlineTitle}>
        {m.status.unreachableBody}
      </Banner>
    );
  }
  if (!status.data) return null;
  const staleOnChain = markets.data?.markets.filter((x) => x.oracleStale).map((x) => x.symbol) ?? [];
  const { staleSymbols, degraded } = serviceHealth(status.data, chain.id, staleOnChain);
  return (
    <>
      {staleSymbols.length > 0 && (
        <Banner tone="caution" title={m.status.staleTitle}>
          {m.status.staleBody(staleSymbols.map((s) => stockOn(chain, s)?.tokenSymbol ?? s).join(", "))}
        </Banner>
      )}
      {degraded && (
        <Banner tone="caution" title={m.status.serviceTitle}>
          {m.status.serviceBody}
        </Banner>
      )}
    </>
  );
}
