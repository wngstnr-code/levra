import type { Warning } from "@levra/shared/api";
import type { LevraIconName } from "@/components/icons/LevraIcon";
import type { Messages } from "./i18n/en";

export type WarningCode = Warning["code"];

const icons: Record<WarningCode, LevraIconName> = {
  ORACLE_STALE: "pricePaused",
  SESSION_CLOSED: "pricePaused",
  PRE_CLOSE_WINDOW: "weekendGuard",
  HIGH_DEVIATION: "debtRatio",
  HIGH_PRICE_IMPACT: "mondayGap",
  NEAR_SOFT_LIMIT: "safeLimit",
  POSITION_CAP: "safeLimit",
  LOW_LIQUIDITY: "lend",
};

export type Notice = { code: WarningCode; icon: LevraIconName; title: string; body: string; blocks: boolean };

/** Turns a quote warning (03, Warning) into the notice designed for it. Red ones block the trade. */
export function noticeFor(w: Warning, m: Messages): Notice {
  const copy = m.notices[w.code];
  return { code: w.code, icon: icons[w.code], title: copy.title, body: copy.body, blocks: w.severity === "block" };
}

export const warningCodes = Object.keys(icons) as WarningCode[];
