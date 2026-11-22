import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

const tones = {
  lime: { box: "border-fg-3 peer-checked:border-lime peer-checked:bg-lime", mark: "text-on-signal" },
  ink: { box: "border-ink/50 peer-checked:border-ink peer-checked:bg-ink", mark: "text-peri" },
};

export function Checkbox({ checked, onChange, tone = "lime", className }: { checked: boolean; onChange: (checked: boolean) => void; tone?: keyof typeof tones; className?: string }) {
  const t = tones[tone];
  return (
    <span className={cn("relative inline-flex size-5 shrink-0", className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-md opacity-0" />
      <span aria-hidden className={cn("pointer-events-none flex size-5 items-center justify-center rounded-md border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-lime/60", t.box)}>
        <Check strokeWidth={3} className={cn("size-3.5 transition-opacity", checked ? "opacity-100" : "opacity-0", t.mark)} />
      </span>
    </span>
  );
}
