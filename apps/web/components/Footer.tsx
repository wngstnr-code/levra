"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";

export function Footer() {
  const m = useT();
  return (
    <footer aria-label={m.a11y.footer} className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-4 pt-4 pb-28 text-[13px] text-fg-3 sm:px-12 lg:pb-10">
      <Link href="/help" className="hover:text-fg-2">
        {m.footer.help}
      </Link>
      <Link href="/help#contracts" className="hover:text-fg-2">
        {m.footer.contracts}
      </Link>
      <span className="hidden md:ml-auto md:inline">{m.footer.rights}</span>
    </footer>
  );
}
