import type { Market } from "@levra/shared/api";
import type { Messages } from "./i18n/en";
import type { Notice } from "./warnings";

/** `oraclePriceE8` "0" means the market's oracle cannot be read (D-100). Never divide by it. */
export function hasNoPrice(priceE8: string | bigint | null | undefined): boolean {
  return priceE8 != null && BigInt(priceE8) === 0n;
}

/** A blocking notice when the issuer halted the market (BE-75) or paused the token, else null. */
export function haltNotice(market: Pick<Market, "haltReasons" | "tokenPaused"> | null | undefined, m: Messages): Omit<Notice, "code"> | null {
  if (!market) return null;
  const reasons = market.haltReasons ?? [];
  if (reasons.length === 0 && !market.tokenPaused) return null;
  return { icon: "pricePaused", blocks: true, title: m.halt.title, body: reasons.length > 0 ? reasons.join(" ") : m.halt.tokenPaused };
}

export function noPriceNotice(m: Messages): Omit<Notice, "code"> {
  return { icon: "pricePaused", blocks: true, title: m.noPrice.title, body: m.noPrice.body };
}

/** Without a price only adding funds, repaying and a full close work (D-100); any other tab falls back to close. */
export function manageTabs<T extends string>(all: readonly T[], noPrice: boolean, asked: T): { tabs: T[]; tab: T } {
  const tabs = noPrice ? all.filter((t) => t === "add" || t === "repay" || t === "close") : [...all];
  return { tabs, tab: tabs.includes(asked) ? asked : ("close" as T) };
}
