import Link from "next/link";

const columns = [
  ["Trade on Levra", [["Markets", "/monad/markets"], ["Trade", "/monad/trade"], ["Earn", "/monad/earn"], ["Stats", "/monad/stats"]]],
  ["Learn", [["How it works", "/monad/help"], ["Risks", "/monad/help#risks"], ["Close without Levra", "/exit"], ["Contracts", "/monad/help#contracts"]]],
  ["Networks", [["Monad", "/monad/markets"], ["Base", "/base/markets"], ["X Layer", "/xlayer/markets"]]],
] as const;

const collage = [
  ["/landing/nvda.jpg", "-rotate-6", "left-[-2%]"],
  ["/landing/qqq.jpg", "rotate-3", "left-[19%]"],
  ["/landing/chain-base.jpg", "-rotate-2", "left-[40%]"],
  ["/landing/spy.jpg", "rotate-6", "left-[61%]"],
  ["/landing/tsla.jpg", "-rotate-3", "left-[81%]"],
] as const;

const POINTER = "cursor-[url(/cursor/pointer.svg)_28_28,pointer]";

/** Footer after the reference: link columns, a full-width wordmark over a collage of cards. */
export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden bg-gradient-to-b from-[#0a0a0b] via-[#3d2f9e] to-[#836ef9] text-white">
      <div className="relative z-10 flex justify-end gap-16 px-[10.3%] pt-[14vh]">
        {columns.map(([title, links]) => (
          <div key={title} className="flex flex-col gap-4">
            <p className="font-[family-name:var(--font-league)] text-[26px] leading-none uppercase">{title}</p>
            {links.map(([label, href]) => (
              <Link key={label} href={href} prefetch={false} className={`font-[family-name:var(--font-dm-mono)] text-[12px] tracking-[0.1em] text-white/80 uppercase transition-colors duration-300 hover:text-white ${POINTER}`}>
                {label}
              </Link>
            ))}
          </div>
        ))}
      </div>

      <div className="relative mt-[6vh] h-[34vw] max-h-[520px] min-h-[220px]">
        {collage.map(([src, rot, left]) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt="" aria-hidden loading="lazy" className={`absolute bottom-[-12%] h-[70%] w-[21%] rounded-[12px] object-cover opacity-80 ${rot} ${left}`} />
        ))}
        <p aria-hidden className="absolute inset-x-0 bottom-[6%] text-center font-[family-name:var(--font-league)] text-[33vw] leading-[0.72] tracking-[0.06em] select-none">
          LEVRA
        </p>
      </div>

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-4 bg-black/40 px-8 py-5 font-[family-name:var(--font-dm-mono)] text-[11px] tracking-[0.1em] text-white/75 uppercase backdrop-blur">
        <span>© 2026 Levra · Not available in the US · Not audited</span>
        <span className="flex gap-4">
          <Link href="/monad/help#risks" className={`hover:text-white ${POINTER}`}>
            Risk disclosure
          </Link>
          <span aria-hidden>|</span>
          <Link href="/monad/help" className={`hover:text-white ${POINTER}`}>
            Terms
          </Link>
        </span>
      </div>
    </footer>
  );
}
