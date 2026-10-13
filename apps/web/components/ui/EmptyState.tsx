import { cn } from "@/lib/cn";
import { Card } from "./Card";

type Tone = "lime" | "plain" | "down";
const marks: Record<Tone, string> = { lime: "bg-lime text-ink", plain: "bg-surface-3 text-fg", down: "bg-down text-ink" };

/** The one style for empty, signed-out and error states on every page. */
export function EmptyState({ glyph, tone = "plain", title, body, action, className }: { glyph: string; tone?: Tone; title: string; body: string; action?: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("flex flex-col items-center gap-3 py-12 text-center", className)}>
      <span aria-hidden className={cn("flex size-14 items-center justify-center rounded-full text-2xl font-bold", marks[tone])}>
        {glyph}
      </span>
      <p className="text-lg font-semibold">{title}</p>
      <p className="max-w-md text-sm text-fg-2">{body}</p>
      {action}
    </Card>
  );
}
