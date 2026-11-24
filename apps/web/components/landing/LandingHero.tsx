"use client";

import gsap from "gsap";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { HeroScene, palette, webglAvailable, type Palette } from "./heroScene";
import { stockMarks } from "./marks";

type Slide = { symbol: string; name: string; chain: "monad" | "base" | "xlayer"; chainName: string; line: string; image: string; tile: string; colors: Palette };

const slides: Slide[] = [
  { symbol: "NVDA", name: "NVIDIA", chain: "base", chainName: "BASE", line: "LONG, SHORT OR LEND NVDA ON BASE", image: "/landing/nvda.jpg", tile: "#76B900", colors: palette("#3c5a1a", "#a6c96a") },
  { symbol: "TSLA", name: "TESLA", chain: "base", chainName: "BASE", line: "PROFIT WHEN TSLA FALLS, OR RIDE IT UP", image: "/landing/tsla.jpg", tile: "#CC0000", colors: palette("#5c1f1c", "#d0806f") },
  { symbol: "QQQ", name: "NASDAQ 100", chain: "monad", chainName: "MONAD", line: "THE QQQ ETF AS A TOKEN, WITH LEVERAGE", image: "/landing/qqq.jpg", tile: "#836EF9", colors: palette("#36285f", "#a796f0") },
  { symbol: "AAPL", name: "APPLE", chain: "base", chainName: "BASE", line: "LEND AAPL AND EARN INTEREST", image: "/landing/aapl.jpg", tile: "#1C1C1F", colors: palette("#4a4c52", "#c3c6cf") },
  { symbol: "SPY", name: "S&P 500", chain: "xlayer", chainName: "X LAYER", line: "THE SPY ETF ON X LAYER, LONG OR SHORT", image: "/landing/spy.jpg", tile: "#2B2B30", colors: palette("#2f4a63", "#9fc0dd") },
  { symbol: "META", name: "META", chain: "base", chainName: "BASE", line: "LONG META WITH UP TO 2× ON BASE", image: "/landing/meta.jpg", tile: "#0467DF", colors: palette("#1a3474", "#86a9f2") },
];

const N = slides.length;
/** Seconds between automatic turns while nobody touches the carousel. */
const AUTOPLAY = 7;
const POINTER = "cursor-[url(/cursor/pointer.svg)_28_28,pointer]";

const wrap = (i: number) => ((i % N) + N) % N;

function Mark({ symbol, className }: { symbol: string; className?: string }) {
  const d = stockMarks[symbol];
  if (!d) return <span className="font-[family-name:var(--font-league)] text-[22px] leading-none text-white">{symbol}</span>;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d={d} fill="#fff" />
    </svg>
  );
}

export function LandingHero() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const section = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const scene = useRef<HeroScene | null>(null);
  const pos = useRef(0);
  const tween = useRef<gsap.core.Tween | null>(null);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const lastTouch = useRef(0);
  const [active, setActive] = useState(0);
  const [gl, setGl] = useState(true);
  const slide = slides[active]!;

  const apply = useCallback((v: number) => {
    pos.current = v;
    if (scene.current) {
      scene.current.progress = v;
      scene.current.draw();
    }
    setActive(wrap(Math.round(v)));
  }, []);

  const goTo = useCallback(
    (target: number) => {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      tween.current?.kill();
      const proxy = { v: pos.current };
      tween.current = gsap.to(proxy, { v: target, duration: still ? 0 : 1.1, ease: "power3.inOut", onUpdate: () => apply(proxy.v) });
    },
    [apply],
  );

  useEffect(() => {
    const el = canvas.current;
    if (!el || !webglAvailable()) {
      setGl(false);
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = new HeroScene(
      el,
      slides.map((x) => x.image),
      slides[0]!.colors,
      still,
    );
    scene.current = s;
    const onResize = () => s.resize();
    window.addEventListener("resize", onResize);
    const io = new IntersectionObserver(([e]) => (e?.isIntersecting && !document.hidden && !still ? s.play() : s.pause()));
    if (section.current) io.observe(section.current);
    const onVisibility = () => (document.hidden || still ? s.pause() : s.play());
    document.addEventListener("visibilitychange", onVisibility);
    if (!still) s.play();
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      io.disconnect();
      s.destroy();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setPalette(slide.colors);
    if (!copy.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(copy.current.children, { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, stagger: 0.07, ease: "power3.out" });
  }, [slide]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (drag.current || document.hidden || Date.now() - lastTouch.current < AUTOPLAY * 1000) return;
      goTo(Math.round(pos.current) + 1);
    }, AUTOPLAY * 1000);
    return () => window.clearInterval(id);
  }, [goTo]);

  const touch = useCallback(() => {
    lastTouch.current = Date.now();
  }, []);

  const onDown = (e: React.PointerEvent) => {
    touch();
    tween.current?.kill();
    drag.current = { x: e.clientX, start: pos.current };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Capture is best effort; the drag still works inside the stage.
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const rect = section.current?.getBoundingClientRect();
    if (rect) scene.current?.pointer((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, Math.abs(e.movementX) + Math.abs(e.movementY));
    if (!drag.current) return;
    apply(drag.current.start - (e.clientX - drag.current.x) / (window.innerWidth * 0.6));
  };
  const onUp = () => {
    if (!drag.current) return;
    const { start } = drag.current;
    drag.current = null;
    touch();
    const moved = pos.current - start;
    goTo(Math.abs(moved) < 0.06 ? Math.round(start) : Math.round(start) + Math.sign(moved) * Math.max(1, Math.round(Math.abs(moved))));
  };

  const step = (dir: number) => {
    touch();
    goTo(Math.round(pos.current) + dir);
  };
  const show = (i: number) => {
    touch();
    const here = Math.round(pos.current);
    const d = ((((i - here) % N) + N + N / 2) % N) - N / 2;
    goTo(here + Math.round(d));
  };

  return (
    <section ref={section} className="relative h-[calc(100svh-96px)] min-h-[720px] overflow-hidden bg-black" aria-roledescription="carousel" aria-label="Featured stocks">
      <canvas ref={canvas} aria-hidden className="absolute inset-0 h-full w-full" />
      {!gl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slide.image} alt="" className="absolute inset-x-[12%] top-[8%] h-[70%] w-[76%] -rotate-3 rounded-[6px] object-cover" />
      )}

      <div
        className="absolute inset-0 cursor-[url(/cursor/move.svg)_28_28,move] touch-pan-y select-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%] bg-gradient-to-b from-transparent to-black/80" />

      <div ref={copy} className="pointer-events-none absolute bottom-[7%] left-[10%] z-10 flex max-w-[680px] flex-col items-start gap-3" aria-live="polite">
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
        <Link href={`/${slide.chain}/trade?symbol=${slide.symbol}`} className={`pointer-events-auto mt-3 rounded-full bg-gradient-to-r from-[#d4ee8c] via-[#c7b6f2] to-[#a9b8ff] p-[2px] ${POINTER}`}>
          <span className="block rounded-full bg-white px-16 py-4 font-[family-name:var(--font-dm-mono)] text-[15px] tracking-[0.2em] text-[#0a0a0b]">TRADE</span>
        </Link>
      </div>

      <div className="absolute top-1/2 right-[2.5%] z-10 flex -translate-y-1/2 flex-col gap-5">
        {(
          [
            ["Next", 1, "M9 6l7 6-7 6z"],
            ["Previous", -1, "M15 6l-7 6 7 6z"],
          ] as const
        ).map(([label, dir, path]) => (
          <button
            key={label}
            type="button"
            aria-label={`${label} stock`}
            onClick={() => step(dir)}
            className={`rounded-full bg-gradient-to-br from-[#a9b8ff] via-[#c7b6f2] to-[#f5a98a] p-[3px] ${POINTER}`}
          >
            <span className="flex size-[82px] items-center justify-center rounded-full bg-[#0a0a0b]">
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
                <path d={path} fill="#fff" />
              </svg>
            </span>
          </button>
        ))}
      </div>

      <div className="absolute right-[10%] bottom-[7%] z-10 flex flex-col items-end gap-4">
        <Link href="/monad/markets" className={`font-[family-name:var(--font-dm-mono)] text-[16px] tracking-[0.2em] text-white ${POINTER}`}>
          SEE ALL MARKETS ▶
        </Link>
        <div className="flex gap-3">
          {slides.map((s, i) => (
            <button
              key={s.symbol}
              type="button"
              aria-label={`Show ${s.name}`}
              aria-current={i === active}
              onClick={() => show(i)}
              className={`flex size-[64px] items-center justify-center rounded-[8px] p-3.5 transition-[border-color] ${POINTER}`}
              style={{ background: s.tile, border: `${i === active ? 3 : 1}px solid ${i === active ? "#fff" : "rgba(255,255,255,0.2)"}` }}
            >
              <Mark symbol={s.symbol} className="size-full" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
