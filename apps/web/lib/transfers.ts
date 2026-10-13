"use client";

import { useCallback, useSyncExternalStore } from "react";

export type SavedTransfer = { id: string; kind: "deposit" | "withdraw"; label: string; createdAt: number };

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const key = (address: string) => `levra.transfers.${address.toLowerCase()}`;
const cache = new Map<string, { raw: string | null; list: SavedTransfer[] }>();
const EMPTY: SavedTransfer[] = [];

function read(address: string | undefined): SavedTransfer[] {
  if (!address) return EMPTY;
  try {
    const raw = localStorage.getItem(key(address));
    const hit = cache.get(address);
    if (hit && hit.raw === raw) return hit.list;
    const list = raw ? (JSON.parse(raw) as SavedTransfer[]) : EMPTY;
    cache.set(address, { raw, list });
    return list;
  } catch {
    return EMPTY;
  }
}

/**
 * Transfers this browser started, newest first. The API can only read a transfer by its id
 * (10-screens.md), so the ids are kept here until a list endpoint exists.
 */
export function useSavedTransfers(address: string | undefined) {
  const list = useSyncExternalStore(subscribe, () => read(address), () => EMPTY);
  const add = useCallback(
    (t: SavedTransfer) => {
      if (!address) return;
      try {
        const next = [t, ...read(address).filter((x) => x.id !== t.id)].slice(0, 20);
        localStorage.setItem(key(address), JSON.stringify(next));
      } catch {
        // Without storage the transfer is still followed on this page.
      }
      listeners.forEach((l) => l());
    },
    [address],
  );
  return { list, add };
}
