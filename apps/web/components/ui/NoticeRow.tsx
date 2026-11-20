import { cn } from "@/lib/cn";
import type { Notice } from "@/lib/warnings";
import { LevraIcon } from "../icons/LevraIcon";

/** One notice above an action. On a pastel panel it uses ink, elsewhere the signal colors. */
export function NoticeRow({ notice, onPastel = false }: { notice: Notice; onPastel?: boolean }) {
  return (
    <div
      role={notice.blocks ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-[14px] px-3.5 py-2.5",
        onPastel ? "bg-ink/8" : notice.blocks ? "bg-down-soft" : "bg-caution-soft",
      )}
    >
      <LevraIcon name={notice.icon} size={18} className={cn("mt-0.5 shrink-0", onPastel ? "text-ink" : notice.blocks ? "text-down" : "text-caution")} />
      <div className="min-w-0 text-[13px] leading-snug">
        <p className={cn("font-semibold", onPastel ? "text-ink" : "text-fg")}>{notice.title}</p>
        <p className={onPastel ? "text-ink/70" : "text-fg-2"}>{notice.body}</p>
      </div>
    </div>
  );
}
