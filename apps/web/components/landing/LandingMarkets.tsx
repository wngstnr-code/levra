import Link from "next/link";
import { LogoMark } from "../brand/Logo";

type Card = { title: string; chip: string; line: string; image: string; href: string };

const card = (title: string, chip: string, line: string, image: string, href: string): Card => ({ title, chip, line, image, href });

/** Columns of the bento grid, as in the reference: two small cards, two small cards, one tall card, two small cards. */
const columns: Card[][] = [
  [card("NVIDIA", "Base · Long", "Long NVDA with leverage", "/landing/nvda.jpg", "/base/trade?symbol=NVDA"), card("Tesla", "Base · Short", "Profit when TSLA falls", "/landing/tsla.jpg", "/base/trade?symbol=TSLA&side=short")],
  [card("Nasdaq 100", "Monad · Long", "The QQQ ETF in one token", "/landing/qqq.jpg", "/monad/trade?symbol=QQQ"), card("Apple", "Base · Lend", "Lend AAPL, earn interest", "/landing/aapl.jpg", "/base/earn")],
  [card("S&P 500", "X Layer · Long & short", "The SPY ETF on X Layer", "/landing/spy.jpg", "/xlayer/trade?symbol=SPY")],
  [card("Meta", "Base · Long", "META with leverage", "/landing/meta.jpg", "/base/trade?symbol=META"), card("Monad", "Network", "QQQ, HOOD and BIL", "/landing/chain-monad.jpg", "/monad/markets")],
  [card("Base", "Network", "Eight Coinbase stocks", "/landing/chain-base.jpg", "/base/markets"), card("X Layer", "Network", "Four xStocks", "/landing/chain-xlayer.jpg", "/xlayer/markets")],
];

const POINTER = "cursor-[url(/cursor/pointer.svg)_28_28,pointer]";

function MarketCard({ c, tall }: { c: Card; tall?: boolean }) {
  return (
    <Link
      href={c.href}
      className={`group relative block flex-none rounded-[12px] bg-gradient-to-br from-[#f5a98a] via-[#c7b6f2] to-[#a9b8ff] p-[2px] transition-shadow duration-300 hover:shadow-[0_0_0_6px_rgba(199,182,242,0.35)] ${POINTER} ${tall ? "h-[768px] w-[766px]" : "h-[372px] w-[368px]"}`}
    >
      <span className="relative block h-full w-full overflow-hidden rounded-[10px] bg-[#1c1c1f]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)] group-hover:scale-[1.06]" />
        <span className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-b from-transparent to-black/90" />
        <span className="absolute top-5 left-5 rounded-[6px] bg-white/25 px-2.5 py-1 font-[family-name:var(--font-dm-mono)] text-[12px] tracking-[0.1em] text-white uppercase backdrop-blur-sm">{c.chip}</span>
        <span className="absolute inset-x-5 bottom-5 flex flex-col gap-2 text-white">
          <span className="font-[family-name:var(--font-league)] text-[76px] leading-[0.85] uppercase">{c.title}</span>
          <span className="font-[family-name:var(--font-dm-mono)] text-[12px] tracking-[0.1em] uppercase">{c.line}</span>
        </span>
      </span>
    </Link>
  );
}

/** The markets grid the hero's "See all markets" scrolls to. It scrolls sideways when it is wider than the screen. */
export function LandingMarkets() {
  return (
    <section id="markets" className="scroll-mt-[100px] bg-[#eeebf7] py-[12vh] text-[#0a0a0b]">
      <div className="mb-11 flex items-center justify-between px-[10.3%]">
        <h2 className="flex items-center gap-3 font-[family-name:var(--font-league)] text-[56px] leading-none">
          <LogoMark className="size-10 text-[#836ef9]" />
          LEVRA MARKETS
        </h2>
        <Link href="/monad/markets" className={`flex items-center gap-2 font-[family-name:var(--font-dm-mono)] text-[12px] tracking-[0.1em] uppercase transition-opacity duration-300 hover:opacity-60 ${POINTER}`}>
          Open the app
          <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
            <path d="M1 0l8 5-8 5z" fill="currentColor" />
          </svg>
        </Link>
      </div>
      <div className="overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-6 px-[10.3%]">
          {columns.map((col, i) => (
            <div key={i} className="flex flex-col gap-6">
              {col.map((c) => (
                <MarketCard key={c.title} c={c} tall={col.length === 1} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
