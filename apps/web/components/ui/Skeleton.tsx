import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-full bg-surface-2", className)} />;
}
