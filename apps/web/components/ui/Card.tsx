import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type CardTone = "plain" | "lime" | "peach" | "peri" | "sage" | "butter" | "lilac";

const tones: Record<CardTone, string> = {
  plain: "bg-surface-1 text-fg",
  lime: "bg-lime text-ink",
  peach: "bg-peach text-ink",
  peri: "bg-peri text-ink",
  sage: "bg-sage text-ink",
  butter: "bg-butter text-ink",
  lilac: "bg-lilac text-ink",
};

/** Bento card. Pastel tones are for identity and the one primary panel of a view only. */
export function Card({ tone = "plain", className, ...props }: HTMLAttributes<HTMLDivElement> & { tone?: CardTone }) {
  return <div className={cn("squircle min-w-0 rounded-card p-7", tones[tone], className)} {...props} />;
}
