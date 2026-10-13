"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useMarketSession } from "@/lib/useMarketSession";
import { SessionBadge } from "./ui/SessionBadge";
import { WalletButton } from "./WalletButton";

const routes = [
  { href: "/markets", key: "markets" },
  { href: "/trade", key: "trade" },
  { href: "/positions", key: "positions" },
] as const;

export function Header() {
  const m = useT();
  const pathname = usePathname();
  const session = useMarketSession();

  return (
    <header className="sticky top-0 z-20 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[88px] max-w-[1440px] items-center gap-12 px-4 sm:px-12">
        <Link href="/markets" className="flex items-center gap-2.5">
          <span aria-hidden className="squircle size-7 rounded-[9px] bg-lime" />
          <span className="text-display text-xl font-semibold">Levra</span>
        </Link>
        <nav className="flex items-center gap-1 rounded-full bg-surface-1 p-[5px]">
          {routes.map((r) => {
            const active = pathname.startsWith(r.href);
            return (
              <Link
                key={r.href}
                href={r.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-[18px] py-[9px] text-sm font-medium transition-colors duration-200 ease-spring",
                  active ? "bg-surface-3 text-fg" : "text-fg-2 hover:text-fg",
                )}
              >
                {m.nav[r.key]}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {session && <SessionBadge session={session} />}
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
