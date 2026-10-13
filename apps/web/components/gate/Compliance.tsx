"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useAccount } from "wagmi";
import { describeError } from "@/lib/contractErrors";
import { useT } from "@/lib/i18n";
import { useCompliance, type ComplianceStatus } from "@/lib/useCompliance";
import { Button, ButtonLink } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { TermsSheet } from "./TermsSheet";

type Gate = {
  status: ComplianceStatus;
  /** True when opening, supplying and depositing are allowed. Closing and withdrawing never ask. */
  allowed: boolean;
  openTerms: () => void;
  retry: () => void;
  error: unknown;
};

const GateContext = createContext<Gate>({ status: "unchecked", allowed: true, openTerms: () => {}, retry: () => {}, error: null });

export function ComplianceProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const c = useCompliance(address);
  const [open, setOpen] = useState(false);
  const openTerms = useCallback(() => setOpen(true), []);
  const allowed = c.status === "ok" || c.status === "unchecked";
  return (
    <GateContext.Provider value={{ status: c.status, allowed, openTerms, retry: () => void c.retry(), error: c.error }}>
      {children}
      {c.status === "needsTerms" && c.termsVersion && <TermsSheet open={open} onClose={() => setOpen(false)} version={c.termsVersion} accept={c.accept} />}
    </GateContext.Provider>
  );
}

export const useGate = () => useContext(GateContext);

/** The screen for a region the issuer does not allow. It points to Positions, where closing always works. */
export function RegionBlocked() {
  const m = useT();
  return (
    <div className="space-y-4">
      <EmptyState glyph="!" tone="down" title={m.gate.blockedTitle} body={m.gate.blockedBody} />
      <Card className="flex flex-wrap items-center gap-4">
        <p className="flex-1 text-sm text-fg-2">{m.gate.blockedKeep}</p>
        <ButtonLink href="/positions">{m.gate.goPositions}</ButtonLink>
      </Card>
    </div>
  );
}

/** For screens whose only action is to open a position: blocked regions and failed checks replace the screen. */
export function OpenGate({ children }: { children: React.ReactNode }) {
  const m = useT();
  const g = useGate();
  if (g.status === "blocked") return <RegionBlocked />;
  if (g.status === "error")
    return <EmptyState glyph="!" tone="down" title={m.common.notAvailable} body={`${m.gate.checkError} ${describeError(g.error, m)}`} action={<Button variant="secondary" onClick={g.retry}>{m.common.tryAgain}</Button>} />;
  return <>{children}</>;
}

/** The label and action for a gated button, or null when the gate is open. */
export function useGatedAction(): { label: string; onClick: (() => void) | null } | null {
  const m = useT();
  const g = useGate();
  if (g.allowed) return null;
  if (g.status === "needsTerms") return { label: m.gate.acceptFirst, onClick: g.openTerms };
  if (g.status === "blocked") return { label: m.gate.blockedTitle, onClick: null };
  if (g.status === "loading") return { label: m.common.loading, onClick: null };
  return { label: m.common.notAvailable, onClick: g.retry };
}
