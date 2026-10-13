import { cn } from "@/lib/cn";
import { stockTone, toneBg } from "@/lib/tones";

/** A round mark for a stock, in its own pastel. On a pastel card it turns ink so it stays visible. */
export function TokenIcon({ symbol, size = 40, inverted = false, className }: { symbol: string; size?: number; inverted?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold", inverted ? "bg-ink text-fg" : cn(toneBg[stockTone(symbol)], "text-ink"), className)}
    >
      {symbol.slice(0, 1)}
    </span>
  );
}
