"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApiSession } from "@/lib/api/hooks";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { formatDuration } from "@/lib/units";
import { useMarketSession } from "@/lib/useMarketSession";
import { useNowSeconds } from "@/lib/useNow";
import { SessionBadge } from "./ui/SessionBadge";
import { WalletButton } from "./WalletButton";

export const routes = [
  { href: "/markets", key: "markets", glyph: "◧" },
  { href: "/trade", key: "trade", glyph: "⇅" },
  { href: "/positions", key: "positions", glyph: "◔" },
  { href: "/earn", key: "earn", glyph: "%" },
  { href: "/deposit", key: "deposit", glyph: "↓" },
  { href: "/settings", key: "settings", glyph: "⚙" },
] as const;

export function Header() {
  const m = useT();
  const pathname = usePathname();
  const session = useMarketSession();
  const api = useApiSession();
  const now = useNowSeconds();
  const closeIn = api.data?.closedRegime && api.data.session !== "CLOSED" && api.data.nextCloseAt && api.data.nextCloseAt > now ? api.data.nextCloseAt - now : null;

  return (
    <>
      <a href="#content" className="sr-only z-50 rounded-full bg-lime px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        {m.a11y.skip}
      </a>
      <header className="sticky top-0 z-20 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-4 sm:h-[88px] sm:px-12 lg:gap-12">
          <Link href="/markets" className="flex items-center gap-2.5">
            <span aria-hidden className="squircle size-7 rounded-[9px] bg-lime" />
            <span className="text-display text-xl font-semibold">Levra</span>
          </Link>
          <nav aria-label={m.a11y.mainNav} className="hidden items-center gap-1 rounded-full bg-surface-1 p-[5px] lg:flex">
            {routes.map((r) => {
              const active = pathname.startsWith(r.href);
              return (
                <Link
                  key={r.href}
                  href={r.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("rounded-full px-[18px] py-[9px] text-sm font-medium transition-colors duration-200 ease-spring", active ? "bg-surface-3 text-fg" : "text-fg-2 hover:text-fg")}
                >
                  {m.nav[r.key]}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {session && <SessionBadge className="hidden sm:inline-flex" session={session} warn={closeIn !== null} label={closeIn !== null ? m.session.closesIn(formatDuration(closeIn)) : undefined} />}
            <WalletButton />
          </div>
        </div>
      </header>
    </>
  );
}

/** The tab bar on phones, where the top navigation does not fit. */
export function BottomNav() {
  const m = useT();
  const pathname = usePathname();
  return (
    <nav aria-label={m.a11y.mainNav} className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <ul className="mx-auto grid max-w-xl grid-cols-6">
        {routes.map((r) => {
          const active = pathname.startsWith(r.href);
          return (
            <li key={r.href}>
              <Link href={r.href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", active ? "text-lime" : "text-fg-2")}>
                <span aria-hidden className="text-lg leading-none">
                  {r.glyph}
                </span>
                {m.nav[r.key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
