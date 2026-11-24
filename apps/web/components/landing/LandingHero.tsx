"use client";

import gsap from "gsap";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Contour } from "./Contour";
import { stockMarks } from "./marks";

type Slide = { symbol: string; name: string; chain: "monad" | "base" | "xlayer"; chainName: string; line: string; image: string; tile: string };

const slides: Slide[] = [
  { symbol: "NVDA", name: "NVIDIA", chain: "base", chainName: "BASE", line: "LONG, SHORT OR LEND NVDA ON BASE", image: "/landing/nvda.jpg", tile: "#76B900" },
  { symbol: "TSLA", name: "TESLA", chain: "base", chainName: "BASE", line: "PROFIT WHEN TSLA FALLS, OR RIDE IT UP", image: "/landing/tsla.jpg", tile: "#CC0000" },
  { symbol: "QQQ", name: "NASDAQ 100", chain: "monad", chainName: "MONAD", line: "THE QQQ ETF AS A TOKEN, WITH LEVERAGE", image: "/landing/qqq.jpg", tile: "#836EF9" },
  { symbol: "AAPL", name: "APPLE", chain: "base", chainName: "BASE", line: "LEND AAPL AND EARN INTEREST", image: "/landing/aapl.jpg", tile: "#1C1C1F" },
  { symbol: "SPY", name: "S&P 500", chain: "xlayer", chainName: "X LAYER", line: "THE SPY ETF ON X LAYER, LONG OR SHORT", image: "/landing/spy.jpg", tile: "#2B2B30" },
  { symbol: "META", name: "META", chain: "base", chainName: "BASE", line: "LONG META WITH UP TO 2× ON BASE", image: "/landing/meta.jpg", tile: "#0467DF" },
];

const N = slides.length;
/** Degrees between neighbouring cards on the cylinder. */
const STEP = 30;

/** Signed distance from the current position, wrapped so the carousel loops. */
function offset(i: number, pos: number) {
  return ((((i - pos) % N) + N + N / 2) % N) - N / 2;
}

function Mark({ symbol, className }: { symbol: string; className?: string }) {
  const d = stockMarks[symbol];
  if (!d) return <span className={className + " font-[family-name:var(--font-league)] text-[22px] leading-none text-white"}>{symbol}</span>;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d={d} fill="#fff" />
    </svg>
  );
}

export function LandingHero() {
  const [pos, setPos] = useState(0);
  const posRef = useRef(0);
  const tween = useRef<gsap.core.Tween | null>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  const active = ((Math.round(pos) % N) + N) % N;
  const slide = slides[active]!;

  useEffect(() => {
    const measure = () => setWidth(Math.min(window.innerWidth * 0.7, 1120));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const goTo = useCallback((target: number) => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    tween.current?.kill();
    const proxy = { v: posRef.current };
    tween.current = gsap.to(proxy, {
      v: target,
      duration: still ? 0 : 0.9,
      ease: "power3.out",
      onUpdate: () => {
        posRef.current = proxy.v;
        setPos(proxy.v);
      },
    });
  }, []);

  useEffect(() => {
    if (!copy.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(copy.current.children, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.06, ease: "power3.out" });
  }, [active]);

  const height = width * 0.56;
  const radius = width / 2 / Math.tan(((STEP / 2) * Math.PI) / 180) + 40;

  const onDown = (e: React.PointerEvent) => {
    tween.current?.kill();
    drag.current = { x: e.clientX, start: posRef.current, moved: false };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Capture is best effort; the drag still works inside the stage.
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    posRef.current = drag.current.start - dx / (width * 0.9);
    setPos(posRef.current);
  };
  const onUp = () => {
    if (!drag.current) return;
    const { start } = drag.current;
    drag.current = null;
    const moved = posRef.current - start;
    // A short flick is enough to move one card, like the reference; longer drags move further.
    goTo(Math.abs(moved) < 0.06 ? Math.round(start) : Math.round(start) + Math.sign(moved) * Math.max(1, Math.round(Math.abs(moved))));
  };

  return (
    <section className="relative h-[calc(100svh-96px)] min-h-[720px] overflow-hidden bg-[#2e2b3a]" aria-roledescription="carousel" aria-label="Featured stocks">
      <Contour className="absolute inset-0 h-full w-full" />

      <div
        ref={stage}
        className="absolute inset-0 cursor-[url(/cursor/move.svg)_28_28,move] touch-pan-y select-none"
        style={{ perspective: "1800px" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="absolute inset-0" style={{ transformStyle: "preserve-3d", transform: `translateY(-2%) rotateZ(-4deg) rotateX(4deg) translateZ(${-radius}px)` }}>
          {slides.map((s, i) => {
            const d = offset(i, pos);
            const visible = Math.abs(d) < 1.7;
            return (
              <div
                key={s.symbol}
                className="absolute top-1/2 left-1/2 overflow-hidden rounded-[6px] bg-[#1c1c1f] [backface-visibility:hidden]"
                style={{
                  width,
                  height,
                  marginLeft: -width / 2,
                  marginTop: -height / 2,
                  transform: `rotateY(${d * STEP}deg) translateZ(${radius}px)`,
                  opacity: visible ? 1 : 0,
                  pointerEvents: "none",
                }}
                aria-hidden={i !== active}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.image} alt="" draggable={false} className="h-full w-full object-cover" />
              </div>
            );
          })}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-b from-transparent to-[#0a0a0bd9]" />

      <div ref={copy} className="absolute bottom-[7%] left-[10%] z-10 flex max-w-[680px] flex-col items-start gap-3" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="font-[family-name:var(--font-league)] text-[40px] leading-none text-white">FEATURED</span>
          <span className="flex items-center gap-2 rounded-[8px] bg-white/20 px-3 py-1.5 font-[family-name:var(--font-dm-mono)] text-[15px] tracking-[0.15em] text-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/landing/chains/${slide.chain}.png`} alt="" className="size-[18px] rounded-[4px]" />
            {slide.chainName}
          </span>
        </div>
        <h1 className="font-[family-name:var(--font-league)] text-[clamp(96px,12vw,176px)] leading-[0.85] text-white">{slide.name}</h1>
        <p className="font-[family-name:var(--font-dm-mono)] text-[16px] tracking-[0.06em] text-white">{slide.line}</p>
        <Link
          href={`/${slide.chain}/trade?symbol=${slide.symbol}`}
          className="pointer-events-auto mt-3 rounded-full bg-gradient-to-r from-[#d4ee8c] via-[#c7b6f2] to-[#a9b8ff] p-[2px] cursor-[url(/cursor/pointer.svg)_28_28,pointer]"
        >
          <span className="block rounded-full bg-white px-16 py-4 font-[family-name:var(--font-dm-mono)] text-[15px] tracking-[0.2em] text-[#0a0a0b]">TRADE</span>
        </Link>
      </div>

      <div className="absolute top-1/2 right-[2.5%] z-10 flex -translate-y-1/2 flex-col gap-5">
        {[
          ["Next", 1, "M9 6l7 6-7 6z"],
          ["Previous", -1, "M15 6l-7 6 7 6z"],
        ].map(([label, dir, path]) => (
          <button
            key={label as string}
            type="button"
            aria-label={`${label} stock`}
            onClick={() => goTo(Math.round(posRef.current) + (dir as number))}
            className="rounded-full bg-gradient-to-br from-[#a9b8ff] via-[#c7b6f2] to-[#f5a98a] p-[3px] cursor-[url(/cursor/pointer.svg)_28_28,pointer]"
          >
            <span className="flex size-[82px] items-center justify-center rounded-full bg-[#0a0a0b]">
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
                <path d={path as string} fill="#fff" />
              </svg>
            </span>
          </button>
        ))}
      </div>

      <div className="absolute right-[10%] bottom-[7%] z-10 flex flex-col items-end gap-4">
        <Link href="/monad/markets" className="font-[family-name:var(--font-dm-mono)] text-[16px] tracking-[0.2em] text-white cursor-[url(/cursor/pointer.svg)_28_28,pointer]">
          SEE ALL MARKETS ▶
        </Link>
        <div className="flex gap-3">
          {slides.map((s, i) => (
            <button
              key={s.symbol}
              type="button"
              aria-label={`Show ${s.name}`}
              aria-current={i === active}
              onClick={() => goTo(Math.round(posRef.current) + offset(i, Math.round(posRef.current)))}
              className="flex size-[64px] items-center justify-center rounded-[8px] border p-3.5 transition-colors cursor-[url(/cursor/pointer.svg)_28_28,pointer]"
              style={{ background: s.tile, borderColor: i === active ? "#fff" : "rgba(255,255,255,0.2)", borderWidth: i === active ? 3 : 1 }}
            >
              <Mark symbol={s.symbol} className="size-full" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
