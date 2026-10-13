"use client";

import Link from "next/link";
import { useState } from "react";
import { describeError } from "@/lib/contractErrors";
import { useT } from "@/lib/i18n";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

/** First-visit acceptance of the terms and the risk disclosure, with a wallet signature (FE-50). */
export function TermsSheet({ open, onClose, version, accept }: { open: boolean; onClose: () => void; version: string; accept: () => Promise<void> }) {
  const m = useT();
  const [checks, setChecks] = useState([false, false, false]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = [m.gate.checkRegion, m.gate.checkRisk, m.gate.checkTerms(version)];
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await accept();
      onClose();
    } catch (e) {
      setError(describeError(e, m));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={m.gate.termsTitle}>
      <p className="text-[15px] text-fg-2">{m.gate.termsBody}</p>
      {labels.map((l, i) => (
        <label key={i} className="squircle flex cursor-pointer items-start gap-3 rounded-[18px] bg-surface-1 px-4 py-3.5">
          <input type="checkbox" checked={checks[i]} onChange={(e) => setChecks((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} className="mt-0.5 size-5 shrink-0 accent-lime" />
          <span className="text-sm leading-relaxed">{l}</span>
        </label>
      ))}
      <Link href="/help#risks" className="text-sm font-medium text-lime">
        {m.gate.readRisks} ↗
      </Link>
      {error && <p className="text-sm text-down">{error}</p>}
      <Button size="lg" onClick={submit} disabled={!checks.every(Boolean) || busy}>
        {busy ? m.gate.signing : m.gate.sign}
      </Button>
    </Sheet>
  );
}
