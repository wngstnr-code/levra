"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "../brand/Logo";
import { GlowButton } from "./GlowButton";

const links = [
  ["MARKETS", "/monad/markets"],
  ["EARN", "/monad/earn"],
  ["STATS", "/monad/stats"],
  ["HELP", "/monad/help"],
] as const;

const POINTER = "cursor-[url(/cursor/pointer.svg)_28_28,pointer]";

/** Floats over the hero like the reference: no fill, a hairline under it, links in the condensed face. */
export function LandingNav() {
  // Over the hero the nav is clear; past it, it turns solid black like the reference so it reads on light sections.
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > window.innerHeight - 110);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={`fixed inset-x-0 top-0 z-30 h-[100px] border-b border-white/20 transition-colors duration-500 ${solid ? "bg-black" : "bg-gradient-to-b from-black/60 to-transparent"}`}>
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
        <GlowButton href="/monad/markets" label="Open app" className="ml-auto" />
      </div>
    </header>
  );
}
