"use client";

import gsap from "gsap";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { HeroScene, palette, webglAvailable, type Palette } from "./heroScene";
import { GlowButton, GlowRound } from "./GlowButton";
import { stockMarks } from "./marks";

type Slide = { symbol: string; name: string; chain: "monad" | "base" | "xlayer"; chainName: string; line: string; image: string; tile: string; colors: Palette };

const slides: Slide[] = [
  { symbol: "NVDA", name: "NVIDIA", chain: "base", chainName: "BASE", line: "LONG, SHORT OR LEND NVDA ON BASE", image: "/landing/nvda.jpg", tile: "#76B900", colors: palette("#3c5a1a", "#a6c96a") },
  { symbol: "TSLA", name: "TESLA", chain: "base", chainName: "BASE", line: "PROFIT WHEN TSLA FALLS, OR RIDE IT UP", image: "/landing/tsla.jpg", tile: "#CC0000", colors: palette("#5c1f1c", "#d0806f") },
  { symbol: "QQQ", name: "NASDAQ 100", chain: "monad", chainName: "MONAD", line: "THE QQQ ETF AS A TOKEN, WITH LEVERAGE", image: "/landing/qqq.jpg", tile: "#836EF9", colors: palette("#36285f", "#a796f0") },
  { symbol: "AAPL", name: "APPLE", chain: "base", chainName: "BASE", line: "LEND AAPL AND EARN INTEREST", image: "/landing/aapl.jpg", tile: "#1C1C1F", colors: palette("#4a4c52", "#c3c6cf") },
  { symbol: "SPY", name: "S&P 500", chain: "xlayer", chainName: "X LAYER", line: "THE SPY ETF ON X LAYER, LONG OR SHORT", image: "/landing/spy.jpg", tile: "#2B2B30", colors: palette("#2f4a63", "#9fc0dd") },
  { symbol: "META", name: "META", chain: "base", chainName: "BASE", line: "LONG META WITH LEVERAGE ON BASE", image: "/landing/meta.jpg", tile: "#0467DF", colors: palette("#1a3474", "#86a9f2") },
];

const N = slides.length;
/** Seconds between automatic turns while nobody touches the carousel. */
const AUTOPLAY = 7;

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
    const el = copy.current;
    // The title rises out of its own mask; the lines around it fade up a moment later, like the reference.
    gsap.fromTo(el.querySelectorAll("[data-reveal]"), { yPercent: 105 }, { yPercent: 0, duration: 0.8, ease: "power3.out" });
    gsap.fromTo(el.querySelectorAll("[data-fade]"), { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.06, delay: 0.1, ease: "power2.out" });
  }, [slide]);

  // The background and the tilt follow the pointer anywhere over the hero, the floating nav included.
  useEffect(() => {
    let last: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      const rect = section.current?.getBoundingClientRect();
      if (!rect || e.clientY > rect.bottom || e.clientY < rect.top) {
        last = null;
        return;
      }
      const dx = last ? (e.clientX - last.x) / rect.width : 0;
      const dy = last ? (e.clientY - last.y) / rect.height : 0;
      last = { x: e.clientX, y: e.clientY };
      scene.current?.pointer((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, dx, dy);
    };
    const onLeave = () => {
      last = null;
      scene.current?.pointer(0.5, 0.5);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

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
    <section ref={section} className="relative h-svh min-h-[720px] overflow-hidden bg-black" aria-roledescription="carousel" aria-label="Featured stocks">
      <canvas ref={canvas} aria-hidden className="absolute inset-0 h-full w-full" />
      {!gl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slide.image} alt="" className="absolute inset-x-[12%] top-[20%] h-[64%] w-[72%] -rotate-3 rounded-[6px] object-cover" />
      )}

      <div
        className="absolute inset-0 cursor-[url(/cursor/move.svg)_28_28,move] touch-pan-y select-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[40%] bg-gradient-to-b from-transparent to-black/75" />

      <div ref={copy} className="pointer-events-none absolute top-[62.3%] left-[10.3%] z-10 flex flex-col items-start" aria-live="polite">
        <div data-fade className="flex h-9 items-center gap-3">
          <span className="flex items-center gap-2">
            <span className="size-7">
              <Mark symbol={slide.symbol} className="size-full" />
            </span>
            <span className="font-[family-name:var(--font-league)] text-[32px] leading-none text-white">FEATURED</span>
          </span>
          <span className="flex h-6 items-center gap-1.5 rounded-[6px] bg-white/25 px-2 font-[family-name:var(--font-dm-mono)] text-[12px] tracking-[0.1em] text-white uppercase backdrop-blur-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/landing/chains/${slide.chain}.png`} alt="" className="size-3.5 rounded-[3px]" />
            {slide.chainName}
          </span>
        </div>
        <h1 className="mt-[1.6vh] overflow-hidden">
          <span data-reveal className="block font-[family-name:var(--font-league)] text-[120px] leading-[0.785] text-white uppercase">
            {slide.name}
          </span>
        </h1>
        <p data-fade className="mt-[2.4vh] max-w-[300px] font-[family-name:var(--font-dm-sans)] text-[12px] leading-[1.3] tracking-[0.02em] text-white uppercase">
          {slide.line}
        </p>
        <div data-fade className="pointer-events-auto mt-[3vh]">
          <GlowButton href={`/${slide.chain}/trade?symbol=${slide.symbol}`} label={`Trade ${slide.symbol}`} />
        </div>
      </div>

      <div className="absolute top-[44.9%] right-8 z-10 flex flex-col gap-4">
        <GlowRound label="Next stock" onClick={() => step(1)}>
          <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
            <path d="M7 4l12 8-12 8z" fill="currentColor" />
          </svg>
        </GlowRound>
        <GlowRound label="Previous stock" onClick={() => step(-1)}>
          <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
            <path d="M17 4L5 12l12 8z" fill="currentColor" />
          </svg>
        </GlowRound>
      </div>

      <div className="absolute top-[83.1%] right-[10.4%] z-10 flex flex-col items-end gap-[2.4vh]">
        <Link
          href="#markets"
          className="flex items-center gap-2 font-[family-name:var(--font-dm-mono)] text-[12px] leading-none tracking-[0.1em] text-white uppercase transition-opacity duration-300 hover:opacity-70 cursor-[url(/cursor/pointer.svg)_28_28,pointer]"
        >
          See all markets
          <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
            <path d="M1 0l8 5-8 5z" fill="currentColor" />
          </svg>
        </Link>
        <div className="flex gap-2">
          {slides.map((s, i) => (
            <button
              key={s.symbol}
              type="button"
              aria-label={`Show ${s.name}`}
              aria-current={i === active}
              onClick={() => show(i)}
              className={`relative size-12 overflow-hidden rounded-[8px] transition-[opacity,box-shadow] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] cursor-[url(/cursor/pointer.svg)_28_28,pointer] ${i === active ? "opacity-100 shadow-[0_0_0_2px_#fff]" : "opacity-55 hover:opacity-100"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image} alt="" className="h-full w-full object-cover" />
              {i === active && <span aria-hidden className="absolute inset-x-3 bottom-1 h-[2px] rounded-full bg-white" />}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
