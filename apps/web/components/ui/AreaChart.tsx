"use client";

import { useId, useState } from "react";
import { smoothPath } from "@/lib/chartPath";
import { cn } from "@/lib/cn";

type Tone = "peri" | "lime" | "down" | "up" | "ink";
const colors: Record<Tone, string> = { peri: "var(--color-peri)", lime: "var(--color-lime)", down: "var(--color-down)", up: "var(--color-up)", ink: "var(--color-ink)" };

const W = 600;
const H = 200;

/**
 * A Stocks-style line with a soft fade below. It stretches to its box, so give it a height. `minSpan` is the smallest
 * vertical range as a share of the middle value, so a price that barely moves is drawn nearly flat instead of jagged.
 * With `tooltip`, pointing at the chart (mouse or touch) marks the nearest point and shows its text.
 */
export function AreaChart({
  values,
  tone = "peri",
  baseline,
  minSpan = 0,
  label,
  tooltip,
  className,
}: {
  values: number[];
  tone?: Tone;
  baseline?: number;
  minSpan?: number;
  label: string;
  tooltip?: (index: number) => string;
  className?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const all = baseline !== undefined ? [...values, baseline] : values;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const floor = Math.abs((lo + hi) / 2) * minSpan;
  if (hi - lo < floor) {
    const mid = (lo + hi) / 2;
    lo = mid - floor / 2;
    hi = mid + floor / 2;
  }
  const { line, area, y } = smoothPath(values, W, H, 6, [lo, hi]);
  const svg = (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("block w-full", tooltip ? "h-full" : className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colors[tone]} stopOpacity="0.28" />
          <stop offset="1" stopColor={colors[tone]} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      {baseline !== undefined && <line x1="0" x2={W} y1={y(baseline)} y2={y(baseline)} stroke="var(--color-fg-3)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />}
      <path d={line} fill="none" stroke={colors[tone]} strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
  if (!tooltip) return svg;

  const n = values.length;
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(Math.round(f * (n - 1)));
  };
  const i = hover !== null && hover < n ? hover : null;
  const x = i === null ? 0 : n === 1 ? 50 : (i / (n - 1)) * 100;
  const yPct = i === null ? 0 : (y(values[i]!) / H) * 100;
  const ink = tone === "ink";
  return (
    <div className={cn("relative touch-pan-y select-none", className)} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
      {svg}
      {i !== null && (
        <>
          <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 w-px", ink ? "bg-ink/30" : "bg-fg-3")} style={{ left: `${x}%` }} />
          <div aria-hidden className={cn("pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2", ink ? "ring-ink/20" : "ring-bg")} style={{ left: `${x}%`, top: `${yPct}%`, background: colors[tone] }} />
          <div
            role="status"
            className={cn("pointer-events-none absolute top-0 -translate-x-1/2 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap tabular-nums", ink ? "bg-ink text-fg" : "bg-lime text-ink")}
            style={{ left: `clamp(64px, ${x}%, calc(100% - 64px))` }}
          >
            {tooltip(i)}
          </div>
        </>
      )}
    </div>
  );
}
