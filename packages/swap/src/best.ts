import type { Address } from "viem";
import { SwapError, type SwapProvider, type SwapSource } from "./types";

/** Picks the error that tells the caller the most when every provider failed. */
function combined(errors: unknown[]): SwapError {
  const swapErrors = errors.filter((e): e is SwapError => e instanceof SwapError);
  if (swapErrors.length === errors.length && swapErrors.every((e) => e.code === "NO_ROUTE")) return new SwapError("NO_ROUTE", "No swap route for this size right now.");
  if (swapErrors.some((e) => e.code === "RATE_LIMITED")) return new SwapError("RATE_LIMITED", "The swap providers are rate limiting us. Try again shortly.");
  return new SwapError("UPSTREAM_ERROR", "No swap provider answered.", swapErrors.map((e) => e.message));
}

/**
 * Asks every provider at once and keeps the largest output (BE-96). A provider that fails is skipped, so one slow or
 * rate limited aggregator does not stop a quote. Only providers whose `target` the deployment allows belong in the list.
 */
export function bestRoute(providers: readonly SwapProvider[]): SwapSource {
  if (providers.length === 0) throw new Error("bestRoute needs at least one swap provider");

  async function race<T extends { amountOut: bigint }>(run: (p: SwapProvider) => Promise<T>): Promise<T> {
    const results = await Promise.allSettled(providers.map(run));
    let winner: T | null = null;
    const errors: unknown[] = [];
    for (const r of results) {
      if (r.status === "rejected") errors.push(r.reason);
      else if (r.value.amountOut > 0n && (!winner || r.value.amountOut > winner.amountOut)) winner = r.value;
      else if (r.value.amountOut === 0n) errors.push(new SwapError("NO_ROUTE", "A provider offered nothing."));
    }
    if (!winner) throw combined(errors);
    return winner;
  }

  return {
    async quote(p) {
      return race((provider) => provider.quote(p));
    },
    async price(p) {
      return (await race(async (provider) => ({ amountOut: await provider.price(p) }))).amountOut;
    },
    without(targets) {
      return withoutTargets(providers, targets);
    },
  };
}

/** The best route among `providers` minus those whose target is in `targets`. */
export function withoutTargets(providers: readonly SwapProvider[], targets: readonly Address[]): SwapSource {
  const rest = providers.filter((p) => !targets.some((t) => t.toLowerCase() === p.target.toLowerCase()));
  if (rest.length > 0) return bestRoute(rest);
  const none = async (): Promise<never> => {
    throw new SwapError("NO_ROUTE", "No other swap provider is left for this route.");
  };
  return { quote: none, price: none, without: () => withoutTargets([], []) };
}
