import { cn } from "@/lib/cn";
import { splitDecimal } from "@/lib/format";

/** A formatted amount with fainter decimals, for example "$741" and ".45". It fades in briefly when the value changes. */
export function Money({ value, className, decimalsClassName }: { value: string; className?: string; decimalsClassName?: string }) {
  const { whole, decimals } = splitDecimal(value);
  return (
    <span key={value} className={cn("animate-tick tabular-nums", className)}>
      {whole}
      <span className={cn("text-fg-3", decimalsClassName)}>{decimals}</span>
    </span>
  );
}
