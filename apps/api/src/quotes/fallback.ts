import { SwapError, type SwapSource } from "@levra/swap";
import type { Address } from "viem";
import { ApiHttpError } from "../errors";
import type { QuoteDeps } from "./common";
import { RouteRevert } from "./simulate";

/** Called with the swap target of a route whose transaction reverted, before the quote tries the next provider. */
export type RouteFailed = (target: Address, err: RouteRevert) => void;

const isNoRoute = (err: unknown) => (err instanceof SwapError || err instanceof ApiHttpError) && err.code === "NO_ROUTE";

/**
 * Runs a quote; when its transaction reverts in a way the swap calldata likely caused (`RouteRevert`), runs it again
 * without the providers it used, until none is left (BE-102). The first error is the answer when no other provider
 * has a route, so a user sees why the best route failed, not "no route".
 */
export async function withRouteFallback<T>(deps: QuoteDeps, run: (deps: QuoteDeps) => Promise<T>, onFailed?: RouteFailed): Promise<T> {
  const excluded: Address[] = [];
  let first: RouteRevert | null = null;
  for (;;) {
    const used: Address[] = [];
    const base = excluded.length > 0 ? deps.swap.without!(excluded) : deps.swap;
    const swap: SwapSource = {
      price: (p) => base.price(p),
      async quote(p) {
        const q = await base.quote(p);
        used.push(q.target);
        return q;
      },
    };
    try {
      return await run({ ...deps, swap });
    } catch (err) {
      if (first && isNoRoute(err)) throw first;
      const fresh = used.filter((t) => !excluded.some((e) => e.toLowerCase() === t.toLowerCase()));
      if (!(err instanceof RouteRevert) || !deps.swap.without || fresh.length === 0) throw err;
      first ??= err;
      for (const target of new Set(fresh.map((t) => t.toLowerCase() as Address))) {
        onFailed?.(target, err);
        excluded.push(target);
      }
    }
  }
}
