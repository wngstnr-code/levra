"use client";

import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { type ThemeChoice, useThemeChoice } from "@/lib/theme";

const choices: ThemeChoice[] = ["system", "light", "dark"];

export function ThemeSwitch({ className }: { className?: string }) {
  const m = useT();
  const [choice, setChoice] = useThemeChoice();
  return (
    <div role="radiogroup" aria-label={m.settings.appearance} className={cn("flex gap-1 rounded-full bg-surface-2 p-1", className)}>
      {choices.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={choice === c}
          onClick={() => setChoice(c)}
          className={cn("flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200", choice === c ? "bg-surface-3 text-fg" : "text-fg-2 hover:text-fg")}
        >
          {m.settings.themes[c]}
        </button>
      ))}
    </div>
  );
}
