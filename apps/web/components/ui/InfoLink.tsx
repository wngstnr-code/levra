"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";

/** A small "?" that opens the explanation of a word on the Help page (FE-53). */
export function InfoLink({ term, label }: { term: string; label: string }) {
  const m = useT();
  return (
    <Link
      href={`/help#${term}`}
      aria-label={m.help.info(label)}
      title={m.help.info(label)}
      className="ml-1 inline-flex size-4 items-center justify-center rounded-full bg-surface-3 align-middle text-[10px] font-bold text-fg-2 hover:text-fg"
    >
      ?
    </Link>
  );
}
