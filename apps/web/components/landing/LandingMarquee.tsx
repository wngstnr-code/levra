import { GlowButton } from "./GlowButton";
import { stockMarks } from "./marks";

type Item = { word: string; tile: { kind: "image"; src: string } | { kind: "mark"; symbol: string; bg: string } };

const rowA: Item[] = [
  { word: "LONG", tile: { kind: "image", src: "/landing/chains/monad.png" } },
  { word: "SHORT", tile: { kind: "mark", symbol: "NVDA", bg: "#76B900" } },
  { word: "LEND", tile: { kind: "image", src: "/landing/chains/base.png" } },
  { word: "LEVERAGE", tile: { kind: "mark", symbol: "TSLA", bg: "#CC0000" } },
];
const rowB: Item[] = [
  { word: "MONAD", tile: { kind: "image", src: "/landing/chains/xlayer.png" } },
  { word: "BASE", tile: { kind: "mark", symbol: "AAPL", bg: "#1C1C1F" } },
  { word: "X LAYER", tile: { kind: "mark", symbol: "META", bg: "#0467DF" } },
  { word: "EARN", tile: { kind: "mark", symbol: "GOOGL", bg: "#4285F4" } },
];

function Tile({ t }: { t: Item["tile"] }) {
  if (t.kind === "image")
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={t.src} alt="" className="size-[124px] flex-none rounded-[18px] object-cover" />;
  return (
    <span className="flex size-[124px] flex-none items-center justify-center rounded-[18px] p-7" style={{ background: t.bg }}>
      <svg viewBox="0 0 24 24" className="size-full" aria-hidden>
        <path d={stockMarks[t.symbol]} fill="#fff" />
      </svg>
    </span>
  );
}

function Row({ items, reverse }: { items: Item[]; reverse?: boolean }) {
  const run = (
    <div className="flex flex-none items-center gap-9 pr-9">
      {items.map((it) => (
        <span key={it.word} className="flex items-center gap-9">
          <span className="font-[family-name:var(--font-league)] text-[150px] leading-[0.9] whitespace-nowrap">{it.word}</span>
          <Tile t={it.tile} />
        </span>
      ))}
    </div>
  );
  return (
    <div className="flex overflow-hidden">
      <div className={`marquee flex ${reverse ? "marquee-reverse" : ""}`}>
        {run}
        <div aria-hidden className="flex">
          {run}
        </div>
      </div>
    </div>
  );
}

/** Two rows of words and tiles drifting in opposite directions, then the call to browse. */
export function LandingMarquee() {
  return (
    <section aria-label="What you can do" className="flex flex-col items-center gap-10 overflow-hidden bg-[#eeebf7] pt-[8vh] pb-[16vh] text-[#0a0a0b]">
      <div className="flex w-full flex-col gap-10">
        <Row items={rowA} />
        <Row items={rowB} reverse />
      </div>
      <GlowButton href="/monad/markets" label="Browse all markets" w={220} h={48} />
    </section>
  );
}
