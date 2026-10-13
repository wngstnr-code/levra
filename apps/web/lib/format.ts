/** Formats a base-unit integer as a decimal string. Extra digits are cut, never rounded up. */
export function formatUnitsFixed(raw: bigint, decimals: number, fractionDigits: number): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = abs % scale;
  const sign = negative ? "-" : "";
  const wholeText = whole.toLocaleString("en-US");
  if (fractionDigits === 0) return `${sign}${wholeText}`;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, fractionDigits).padEnd(fractionDigits, "0");
  return `${sign}${wholeText}.${fractionText}`;
}

const PRICE_DECIMALS = 8;

export function formatUsdE8(priceE8: bigint): string {
  return `$${formatUnitsFixed(priceE8, PRICE_DECIMALS, 2)}`;
}

/** Age in seconds as a short text, for example "45s", "12m", "3h 5m", "2d 4h". */
export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
