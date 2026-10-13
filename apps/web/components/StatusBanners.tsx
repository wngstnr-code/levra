"use client";

import { ApiRequestError } from "@/lib/api/client";
import { apiConfigured, useServiceStatus } from "@/lib/api/hooks";
import { useT } from "@/lib/i18n";
import { serviceHealth } from "@/lib/serviceHealth";
import { Banner } from "./ui/Banner";

/** Page-wide notices that must always be visible: no service, a stale price, background services behind. */
export function StatusBanners() {
  const m = useT();
  const status = useServiceStatus();

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
  const { staleSymbols, degraded } = serviceHealth(status.data);
  return (
    <>
      {staleSymbols.length > 0 && (
        <Banner tone="caution" title={m.status.staleTitle}>
          {m.status.staleBody(staleSymbols.map((s) => `a${s}`).join(", "))}
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
