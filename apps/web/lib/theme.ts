"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "levra.theme";

/** Runs before paint, so the first frame already has the chosen theme. Kept as a string for the inline script. */
export const themeBootScript = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
  };
}

function readChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(choice: ThemeChoice, systemLight: boolean): Theme {
  if (choice === "system") return systemLight ? "light" : "dark";
  return choice;
}

function readTheme(): Theme {
  return resolveTheme(readChoice(), window.matchMedia("(prefers-color-scheme: light)").matches);
}

export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, readChoice, () => "system" as const);
  const set = useCallback((next: ThemeChoice) => {
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be blocked; the choice then lasts until the page reloads.
    }
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    listeners.forEach((l) => l());
  }, []);
  return [choice, set];
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "dark" as const);
}
