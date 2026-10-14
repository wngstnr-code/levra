import type { PricePoint } from "@levra/shared/api";

const E8 = 1e8;

/** Prices as plain numbers for drawing only. Never use them for money math. */
export function chartValues(points: PricePoint[]): number[] {
  return points.map((p) => Number(p.oraclePriceE8) / E8);
}

/** Change from the first to the last point, in basis points. Null with fewer than two points. */
export function changeBps(points: PricePoint[]): number | null {
  if (points.length < 2) return null;
  const first = BigInt(points[0]!.oraclePriceE8);
  const last = BigInt(points[points.length - 1]!.oraclePriceE8);
  if (first === 0n) return null;
  return Number(((last - first) * 10_000n) / first);
}
