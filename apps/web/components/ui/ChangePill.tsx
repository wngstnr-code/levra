import { cn } from "@/lib/cn";

type Direction = "up" | "down" | "flat";

const styles: Record<Direction, string> = {
  up: "bg-up-soft text-up",
  down: "bg-down-soft text-down",
  flat: "bg-surface-3 text-fg-2",
};

const arrows: Record<Direction, string> = { up: "↗", down: "↘", flat: "→" };

/** A change always carries an arrow and a sign, so it never relies on colour alone. */
export function ChangePill({ direction, children, className }: { direction: Direction; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold tabular-nums", styles[direction], className)}>
      <span aria-hidden>{arrows[direction]}</span>
      {children}
    </span>
  );
}
