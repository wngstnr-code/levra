import { useId } from "react";
import { smoothPath } from "@/lib/chartPath";
import { cn } from "@/lib/cn";

type Tone = "peri" | "lime" | "down" | "up" | "ink";
const colors: Record<Tone, string> = { peri: "var(--color-peri)", lime: "var(--color-lime)", down: "var(--color-down)", up: "var(--color-up)", ink: "var(--color-ink)" };

const W = 600;
const H = 200;

/** A Stocks-style line with a soft fade below. It stretches to its box, so give it a height. */
export function AreaChart({ values, tone = "peri", baseline, label, className }: { values: number[]; tone?: Tone; baseline?: number; label: string; className?: string }) {
  const id = useId();
  const all = baseline !== undefined ? [...values, baseline] : values;
  const { line, area, y } = smoothPath(values, W, H, 6, [Math.min(...all), Math.max(...all)]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("block w-full", className)}>
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
}
