"use client";

import { usePathname } from "next/navigation";
import { useCallback } from "react";
import { chainPath, defaultChain, webChainBySlug, type WebChain } from "./chains";

export function chainFromPath(pathname: string): WebChain {
  const slug = pathname.split("/")[1] ?? "";
  return webChainBySlug(slug) ?? defaultChain;
}

/** The chain in the URL (/base/markets), or the default chain on pages without one. */
export function useChain(): WebChain {
  return chainFromPath(usePathname() ?? "/");
}

/** Builds links that stay on the current chain. */
export function useChainHref(): (path: string) => string {
  const chain = useChain();
  return useCallback((path: string) => chainPath(chain, path), [chain]);
}

/** The same page on another chain: /monad/trade?x becomes /base/trade?x. */
export function switchChainPath(pathname: string, to: Pick<WebChain, "slug">): string {
  const parts = pathname.split("/");
  if (webChainBySlug(parts[1] ?? "")) parts[1] = to.slug;
  else return chainPath(to, "/markets");
  const rest = parts.slice(2);
  if (rest[0] === "markets" && rest.length > 1) return chainPath(to, "/markets");
  return parts.join("/");
}
