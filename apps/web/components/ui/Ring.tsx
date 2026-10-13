import { cn } from "@/lib/cn";

type Tone = "up" | "caution" | "down" | "lime" | "peri";
const strokes: Record<Tone, string> = { up: "stroke-up", caution: "stroke-caution", down: "stroke-down", lime: "stroke-lime", peri: "stroke-peri" };

/** An Apple-Watch-style ring. `value` and `mark` are shares of the full ring, 0 to 1. */
export function Ring({ value, size = 140, tone = "up", mark, faintMark, children, label, className }: { value: number; size?: number; tone?: Tone; mark?: number; faintMark?: number; children?: React.ReactNode; label: string; className?: string }) {
  const sw = size * 0.11;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const tick = (share: number, cls: string) => {
    const a = share * 2 * Math.PI;
    return (
      <line
        x1={size / 2 + (r - sw / 2 - 3) * Math.cos(a)}
        y1={size / 2 + (r - sw / 2 - 3) * Math.sin(a)}
        x2={size / 2 + (r + sw / 2 + 3) * Math.cos(a)}
        y2={size / 2 + (r + sw / 2 + 3) * Math.sin(a)}
        strokeWidth={2.5}
        strokeLinecap="round"
        className={cls}
      />
    );
  };
  return (
    <div role="img" aria-label={label} className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw} className="stroke-surface-3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          className={cn(strokes[tone], "transition-[stroke-dasharray] duration-300 ease-spring")}
        />
        {faintMark !== undefined && tick(faintMark, "stroke-fg-3")}
        {mark !== undefined && tick(mark, "stroke-fg")}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
