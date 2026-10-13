import { sessionName, type SessionName } from "@levra/shared/api";

/** The oracle returns the session as an enum index in the same order as `sessionName`. */
export function sessionFromIndex(index: number): SessionName {
  return sessionName.options[index] ?? "UNKNOWN";
}

export const sessionLabel: Record<SessionName, string> = {
  UNKNOWN: "Unknown",
  PRE_MARKET: "Pre-market",
  REGULAR: "Open",
  POST_MARKET: "After-hours",
  OVERNIGHT: "Overnight",
  CLOSED: "Closed",
};
