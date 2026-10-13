import { cn } from "@/lib/cn";
import { splitDecimal } from "@/lib/format";

/** A formatted amount with fainter decimals, for example "$741" and ".45". */
export function Money({ value, className, decimalsClassName }: { value: string; className?: string; decimalsClassName?: string }) {
  const { whole, decimals } = splitDecimal(value);
  return (
    <span className={cn("tabular-nums", className)}>
      {whole}
      <span className={cn("text-fg-3", decimalsClassName)}>{decimals}</span>
    </span>
  );
}
