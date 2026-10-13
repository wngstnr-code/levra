"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { en, type Messages } from "./en";
import { id } from "./id";

export type Lang = "en" | "id";

const dictionaries: Record<Lang, Messages> = { en, id };
const STORAGE_KEY = "levra.lang";
const listeners = new Set<() => void>();

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "id" ? "id" : "en";
  } catch {
    return "en";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type I18n = { lang: Lang; setLang: (lang: Lang) => void; m: Messages };

const I18nContext = createContext<I18n>({ lang: "en", setLang: () => {}, m: en });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const lang = useSyncExternalStore(subscribe, readLang, () => "en" as const);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the choice then lasts for this page only.
    }
    listeners.forEach((l) => l());
  }, []);

  const value = useMemo(() => ({ lang, setLang, m: dictionaries[lang] }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
export const useT = () => useContext(I18nContext).m;
