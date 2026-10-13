import { cn } from "@/lib/cn";

/** An iOS-style switch, 51 by 31. */
export function Switch({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-300 ease-spring disabled:opacity-40", on ? "bg-up" : "bg-surface-3")}
    >
      <span className={cn("absolute top-0.5 left-0.5 size-[27px] rounded-full bg-white shadow transition-transform duration-300 ease-spring", on && "translate-x-5")} />
    </button>
  );
}
