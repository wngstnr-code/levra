"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** A yes/no the viewer chose once, kept in this browser. Falls back to "no" when storage is blocked. */
export function useStoredFlag(key: string | null): [boolean, (v: boolean) => void] {
  const read = useCallback(() => {
    if (!key) return false;
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }, [key]);
  const value = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback(
    (v: boolean) => {
      if (!key) return;
      try {
        if (v) localStorage.setItem(key, "1");
        else localStorage.removeItem(key);
      } catch {
        // Storage can be blocked; the choice then lasts until the page reloads.
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
