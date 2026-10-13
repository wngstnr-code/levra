import { formatUnitsFixed } from "./format";

const USD_DECIMALS = 6;
const WAD_DECIMALS = 18;
const MINUS = "−";

const toBig = (v: string | bigint) => (typeof v === "bigint" ? v : BigInt(v));

/** USDC base units (6 decimals) as dollars, for example "$1,234.56". */
export function formatUsd(raw: string | bigint, fractionDigits = 2): string {
  const v = toBig(raw);
  const text = formatUnitsFixed(v < 0n ? -v : v, USD_DECIMALS, fractionDigits);
  return `${v < 0n ? MINUS : ""}$${text}`;
}

/** Like formatUsd, with a plus sign for gains. */
export function formatUsdSigned(raw: string | bigint, fractionDigits = 2): string {
  const v = toBig(raw);
  return v > 0n ? `+${formatUsd(v, fractionDigits)}` : formatUsd(v, fractionDigits);
}

/** A token amount in base units, for example "0.2691". */
export function formatToken(raw: string | bigint, decimals: number, fractionDigits = 4): string {
  return formatUnitsFixed(toBig(raw), decimals, fractionDigits);
}

/** Like formatToken, with a plus sign for gains and a minus sign for losses. */
export function formatTokenSigned(raw: string | bigint, decimals: number, fractionDigits = 4): string {
  const v = toBig(raw);
  const text = formatToken(v < 0n ? -v : v, decimals, fractionDigits);
  return v > 0n ? `+${text}` : v < 0n ? `${MINUS}${text}` : text;
}

/** WAD (1e18 = 100%) as a percentage. Trailing zero decimals are dropped: "73%", "50.1%". */
export function formatWadPercent(wad: string | bigint, fractionDigits = 1): string {
  const text = formatUnitsFixed(toBig(wad) * 100n, WAD_DECIMALS, fractionDigits);
  return `${text.includes(".") ? text.replace(/\.?0+$/, "") : text}%`;
}

/** Basis points as a percentage, signed when asked: "+0.24%", "−2.6%". */
export function formatBps(bps: number, opts: { signed?: boolean; fractionDigits?: number } = {}): string {
  const fixed = (Math.abs(bps) / 100).toFixed(opts.fractionDigits ?? 2);
  const abs = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  const sign = bps < 0 ? MINUS : opts.signed && bps > 0 ? "+" : "";
  return `${sign}${abs}%`;
}

/** Leverage times 100 as "2.00×". */
export function formatLeverage(e2: number): string {
  return `${(e2 / 100).toFixed(2)}×`;
}

/** Parses what a user typed into an amount in base units. Returns null for anything that is not a plain positive decimal. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [whole = "0", fraction = ""] = t.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** Converts a percentage of WAD to the share of a full ring or bar, as a number between 0 and 1. */
export function wadRatio(part: string | bigint, whole: string | bigint): number {
  const w = toBig(whole);
  if (w === 0n) return 0;
  return Math.min(1, Number((toBig(part) * 10_000n) / w) / 10_000);
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const PRICE_DECIMALS = 8;

/** Dollar value, in USDC base units, of a stock amount at an 8-decimal price. */
export function stockValueUsd(amountRaw: string | bigint, priceE8: string | bigint, stockDecimals: number): bigint {
  return (toBig(amountRaw) * toBig(priceE8)) / 10n ** BigInt(stockDecimals + PRICE_DECIMALS - USD_DECIMALS);
}
