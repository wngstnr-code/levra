"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

export function Footer() {
  const { m, lang, setLang } = useI18n();
  return (
    <footer aria-label={m.a11y.footer} className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-4 pt-4 pb-28 text-[13px] text-fg-3 sm:px-12 lg:pb-10">
      <Link href="/help" className="hover:text-fg-2">
        {m.footer.help}
      </Link>
      <Link href="/help#contracts" className="hover:text-fg-2">
        {m.footer.contracts}
      </Link>
      <span className="hidden md:inline">{m.footer.rights}</span>
      <div role="radiogroup" aria-label={m.settings.language} className="ml-auto flex gap-1 rounded-full bg-surface-1 p-1">
        {(["en", "id"] as const).map((l) => (
          <button key={l} role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cn("rounded-full px-3 py-1 font-semibold uppercase", lang === l ? "bg-surface-3 text-fg" : "text-fg-3")}>
            {l}
          </button>
        ))}
      </div>
    </footer>
  );
}
