import Link from "next/link";

const links = [
  ["MARKETS", "/monad/markets"],
  ["EARN", "/monad/earn"],
  ["STATS", "/monad/stats"],
  ["HELP", "/monad/help"],
] as const;

export function LandingNav() {
  return (
    <header className="relative z-20 flex h-[96px] items-center border-b border-white/15 bg-black px-[42px]">
      <Link href="/landing" className="border-[3px] border-white px-4 py-0.5 font-[family-name:var(--font-league)] text-[46px] leading-none tracking-[0.08em] text-white">
        LEVRA
      </Link>
      <nav aria-label="Main" className="absolute left-1/2 flex -translate-x-1/2 gap-[60px]">
        {links.map(([label, href]) => (
          <Link key={label} href={href} className="font-[family-name:var(--font-league)] text-[36px] leading-none text-[#b9b9c2] transition-colors hover:text-white">
            {label}
          </Link>
        ))}
      </nav>
      <Link href="/monad/markets" className="ml-auto rounded-full bg-gradient-to-r from-[#d4ee8c] via-[#c7b6f2] to-[#a9b8ff] p-[2px]">
        <span className="block rounded-full bg-black px-6 py-3 font-[family-name:var(--font-dm-mono)] text-[14px] tracking-[0.2em] text-white">OPEN APP</span>
      </Link>
    </header>
  );
}
