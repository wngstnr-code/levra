import { sessionName, type SessionName } from "@levra/shared/api";

/** The oracle returns the session as an enum index in the same order as `sessionName`. */
export function sessionFromIndex(index: number): SessionName {
  return sessionName.options[index] ?? "UNKNOWN";
}
