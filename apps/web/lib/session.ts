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

export const sessionTone: Record<SessionName, string> = {
  UNKNOWN: "bg-neutral-800 text-neutral-300",
  PRE_MARKET: "bg-sky-950 text-sky-300",
  REGULAR: "bg-emerald-950 text-emerald-300",
  POST_MARKET: "bg-sky-950 text-sky-300",
  OVERNIGHT: "bg-indigo-950 text-indigo-300",
  CLOSED: "bg-neutral-800 text-neutral-300",
};
