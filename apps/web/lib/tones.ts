import type { CardTone } from "@/components/ui/Card";

const stockTones: Record<string, CardTone> = { QQQ: "peri", HOOD: "sage", BIL: "butter" };

/** Each listed stock has its own pastel, used for its card and icon. */
export function stockTone(symbol: string): CardTone {
  return stockTones[symbol] ?? "lilac";
}

export const toneBg: Record<CardTone, string> = {
  plain: "bg-surface-3",
  lime: "bg-lime",
  peach: "bg-peach",
  peri: "bg-peri",
  sage: "bg-sage",
  butter: "bg-butter",
  lilac: "bg-lilac",
};
