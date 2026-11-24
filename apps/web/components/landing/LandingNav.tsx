import Link from "next/link";
import { Logo } from "../brand/Logo";

const links = [
  ["MARKETS", "/monad/markets"],
  ["EARN", "/monad/earn"],
  ["STATS", "/monad/stats"],
  ["HELP", "/monad/help"],
] as const;

const POINTER = "cursor-[url(/cursor/pointer.svg)_28_28,pointer]";

/** Floats over the hero like the reference: no fill, a hairline under it, links in the condensed face. */
export function LandingNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-30 h-[100px] border-b border-white/20 bg-gradient-to-b from-black/60 to-transparent">
      <div className="relative flex h-full items-center px-8">
        <Link href="/landing" aria-label="Levra home" className={`text-white ${POINTER}`}>
          <Logo className="h-9 w-auto [&_g]:fill-white" />
        </Link>
        <nav aria-label="Main" className="absolute left-1/2 flex -translate-x-1/2 gap-12">
          {links.map(([label, href]) => (
            <Link key={label} href={href} className={`font-[family-name:var(--font-league)] text-[26px] leading-none text-white/80 transition-colors duration-300 hover:text-white ${POINTER}`}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
