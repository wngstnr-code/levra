import { cn } from "@/lib/cn";

/** A small figure inside a card. `onPastel` switches to ink on a pastel card. */
export function StatBox({ label, value, sub, onPastel = false, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; onPastel?: boolean; className?: string }) {
  return (
    <div className={cn("squircle flex min-w-0 flex-col gap-1 rounded-panel px-4 py-3.5", onPastel ? "bg-ink/8" : "bg-surface-2", className)}>
      <span className={cn("text-xs", onPastel ? "text-ink/60" : "text-fg-2")}>{label}</span>
      <span className="truncate text-[17px] font-semibold tabular-nums">{value}</span>
      {sub && <span className={cn("text-xs", onPastel ? "text-ink/60" : "text-fg-3")}>{sub}</span>}
    </div>
  );
}
