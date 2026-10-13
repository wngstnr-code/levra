import { cn } from "@/lib/cn";

type Tone = "info" | "caution" | "down";

const dot: Record<Tone, string> = { info: "bg-peri", caution: "bg-caution", down: "bg-down" };

export function Banner({ tone = "info", title, children, action, className }: { tone?: Tone; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div role={tone === "info" ? "status" : "alert"} className={cn("squircle flex items-start gap-3 rounded-panel bg-surface-1 px-5 py-4", className)}>
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot[tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{title}</p>
        {children && <p className="mt-0.5 text-sm text-fg-2">{children}</p>}
      </div>
      {action}
    </div>
  );
}
