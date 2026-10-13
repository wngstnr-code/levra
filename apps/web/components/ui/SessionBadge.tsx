"use client";

import type { SessionName } from "@levra/shared/api";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

const dots: Record<SessionName, string> = {
  REGULAR: "bg-up",
  PRE_MARKET: "bg-butter",
  POST_MARKET: "bg-butter",
  OVERNIGHT: "bg-peri",
  CLOSED: "bg-fg-3",
  UNKNOWN: "bg-fg-3",
};

export function SessionBadge({ session, label, warn = false, className }: { session: SessionName; label?: string; warn?: boolean; className?: string }) {
  const m = useT();
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-medium whitespace-nowrap", className)}>
      <span aria-hidden className={cn("size-2 rounded-full", warn ? "bg-caution" : dots[session])} />
      {label ?? m.session[session]}
    </span>
  );
}
