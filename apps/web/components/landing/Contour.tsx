"use client";

import { useEffect, useRef } from "react";

/** Slowly drifting topographic rings behind the hero, drawn on a 2D canvas. Still when the user asks for reduced motion. */
export function Contour({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let raf = 0;

    const draw = (t: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.32)";
      ctx.lineWidth = 7;
      ctx.lineJoin = "round";
      const cx = w * 0.58;
      const cy = h * 0.55;
      const step = Math.max(w, h) / 26;
      for (let i = 0; i < 24; i++) {
        const r = step * (0.8 + i);
        ctx.beginPath();
        for (let k = 0; k <= 120; k++) {
          const a = (k / 120) * Math.PI * 2;
          const n = 1 + 0.12 * Math.sin(3 * a + i * 0.4 + t * 0.25) + 0.07 * Math.sin(5 * a - i * 0.7 - t * 0.18) + 0.04 * Math.sin(9 * a + i + t * 0.4);
          const x = cx + Math.cos(a) * r * n * 1.3;
          const y = cy + Math.sin(a) * r * n * 0.85;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };

    const loop = (ms: number) => {
      frame = ms / 1000;
      draw(frame);
      raf = requestAnimationFrame(loop);
    };
    if (still) draw(0);
    else raf = requestAnimationFrame(loop);
    const onResize = () => still && draw(0);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
