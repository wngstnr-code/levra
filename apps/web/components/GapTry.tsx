"use client";

import { ltvAfterGapWad } from "@levra/shared/math";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { formatBps, formatWadPercent } from "@/lib/units";

const BPS_TO_WAD = 10n ** 14n;

/** A slider for any gap at the open, computed with the shared formula so it matches the contracts (FE-32). */
export function GapTry({ side, ltvWad, softWad, lltvWad, onPastel = false }: { side: "long" | "short"; ltvWad: string; softWad: string; lltvWad: string; onPastel?: boolean }) {
  const m = useT();
  const [bps, setBps] = useState(side === "long" ? -1000 : 1000);
  const after = ltvAfterGapWad(side, BigInt(ltvWad), BigInt(bps) * BPS_TO_WAD);
  const liquidated = after >= BigInt(lltvWad);
  const overSoft = !liquidated && after > BigInt(softWad);
  return (
    <div className={cn("squircle space-y-2 rounded-panel px-4 py-3.5", onPastel ? "bg-ink/8" : "bg-surface-2")}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className={onPastel ? "text-ink/70" : "text-fg-2"}>{m.gap.tryTitle}</span>
        <span className="ml-auto font-semibold tabular-nums">{m.gap.move(formatBps(bps, { signed: true, fractionDigits: 1 }))}</span>
      </div>
      <input
        type="range"
        aria-label={m.gap.tryTitle}
        min={-5000}
        max={5000}
        step={50}
        value={bps}
        onChange={(e) => setBps(Number(e.target.value))}
        className={cn("w-full", onPastel ? "accent-ink" : "accent-lime")}
      />
      <p className="flex items-center text-sm">
        <span className="tabular-nums">{m.gap.ltvAfter(formatWadPercent(after))}</span>
        <span className={cn("ml-auto font-semibold", liquidated ? "text-down" : overSoft ? "text-caution" : "text-up")}>{liquidated ? m.gap.liquidated : overSoft ? m.gap.aboveSoft : m.gap.safe}</span>
      </p>
    </div>
  );
}
