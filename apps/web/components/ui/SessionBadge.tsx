import type { SessionName } from "@levra/shared/api";
import { cn } from "@/lib/cn";
import { sessionLabel } from "@/lib/session";

const dots: Record<SessionName, string> = {
  REGULAR: "bg-up",
  PRE_MARKET: "bg-butter",
  POST_MARKET: "bg-butter",
  OVERNIGHT: "bg-peri",
  CLOSED: "bg-fg-3",
  UNKNOWN: "bg-fg-3",
};

export function SessionBadge({ session, className }: { session: SessionName; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-medium", className)}>
      <span aria-hidden className={cn("size-2 rounded-full", dots[session])} />
      {sessionLabel[session]}
    </span>
  );
}
