"use client";

import Link from "next/link";
import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * The reference's outlined button: a gradient stroke around a white pill. On hover the fill fades to a radial blue,
 * the label rolls to a white copy, and two echo rings grow out of the border. Pure CSS, so it costs no script.
 */

const POINTER = "cursor-[url(/cursor/pointer.svg)_28_28,pointer]";

function Frame({ w, h, r, round, children }: { w: number; h: number; r: number; round?: boolean; children?: React.ReactNode }) {
  const id = useId().replace(/:/g, "");
  const pad = 16;
  const W = w + pad * 2;
  const H = h + pad * 2;
  return (
    <svg aria-hidden className="pointer-events-none absolute" style={{ top: -pad, left: -pad }} width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <linearGradient id={`g${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="10%" stopColor="#C7B6F2" />
          <stop offset="33%" stopColor="#F5A98A" />
          <stop offset="66%" stopColor="#F3D98B" />
          <stop offset="90%" stopColor="#A9B8FF" />
        </linearGradient>
        <radialGradient id={`r${id}`} cx="80%" cy="90%" r="110%">
          <stop offset="0%" stopColor="#9DB0FF" />
          <stop offset="100%" stopColor="#5B5BF5" />
        </radialGradient>
        <filter id={`b${id}`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id={`s${id}`} x="-30%" y="-80%" width="160%" height="260%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="10" />
          <feFlood floodColor="white" floodOpacity="0.5" />
          <feComposite operator="in" in2="SourceAlpha" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect className="glow-echo glow-echo-far" x={1} y={1} width={W - 2} height={H - 2} rx={round ? H / 2 : r + 16} fill="none" stroke={`url(#g${id})`} strokeWidth={2} />
      <rect className="glow-echo glow-echo-near" x={8} y={8} width={W - 16} height={H - 16} rx={round ? (H - 16) / 2 : r + 8} fill="none" stroke={`url(#g${id})`} strokeWidth={2} />
      <rect className="glow-fill" x={pad} y={pad} width={w} height={h} rx={round ? h / 2 : r} />
      <rect x={pad} y={pad} width={w} height={h} rx={round ? h / 2 : r} fill="none" stroke={`url(#g${id})`} strokeWidth={2} />
      <rect className="glow-hover" x={pad} y={pad} width={w} height={h} rx={round ? h / 2 : r} fill={`url(#r${id})`} stroke={`url(#g${id})`} strokeWidth={4} filter={`url(#s${id})`} />
      <rect className="glow-hover" x={pad} y={pad} width={w} height={h} rx={round ? h / 2 : r} fill="none" stroke={`url(#g${id})`} strokeWidth={4} filter={`url(#b${id})`} />
      <rect className="glow-trace" x={pad} y={pad} width={w} height={h} rx={round ? h / 2 : r} fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" pathLength={100} />
      {children}
    </svg>
  );
}

/** A text button: 156 × 42 by default, label in DM Mono 12 px, rolling on hover. */
export function GlowButton({ href, label, w = 156, h = 42, className }: { href: string; label: string; w?: number; h?: number; className?: string }) {
  return (
    <Link href={href} className={cn("glow group relative inline-block flex-none", POINTER, className)} style={{ width: w, height: h }} data-fill="white">
      <Frame w={w} h={h} r={16} />
      <span className="relative flex h-full items-center justify-center overflow-hidden font-[family-name:var(--font-dm-mono)] text-[12px] leading-none font-medium tracking-[0.1em] uppercase">
        <span className="glow-labels relative block">
          <span className="glow-label block text-[#0a0a0b]">{label}</span>
          <span aria-hidden className="glow-label-alt absolute top-full left-0 block w-full text-white">
            {label}
          </span>
        </span>
      </span>
    </Link>
  );
}

/** A round icon button, 64 px, transparent until hovered. */
export function GlowRound({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cn("glow group relative size-16 flex-none", POINTER)} data-fill="clear">
      <Frame w={64} h={64} r={32} round />
      <span className="relative flex h-full items-center justify-center text-white">{children}</span>
    </button>
  );
}
