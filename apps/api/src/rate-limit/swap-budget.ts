import { SwapError, type SwapProvider, type SwapSource } from "@levra/swap";
import { createBucketStore, type BucketRule } from "./bucket";

/**
 * One budget for all KyberSwap calls from this API, so no amount of client traffic can use up our
 * quota with KyberSwap. The public limit is 3 requests per second (05) and the client spaces calls
 * 350 ms apart, so a full bucket waits about 4 s at most instead of failing upstream. Initial proposal.
 */
export const defaultSwapBudget: BucketRule = { capacity: 12, perMinute: 60 };

/**
 * 1inch's entry plan allows 1 request per second (05) and the client spaces calls 1.1 s apart, so the bucket keeps the
 * wait under about 5 s. Initial proposal.
 */
export const oneInchBudget: BucketRule = { capacity: 5, perMinute: 50 };

/** HTTP calls behind each method: KyberSwap needs a route plus a build for a quote, 1inch one call for either. */
export type SwapCost = { price: number; quote: number };
export const KYBER_COST: SwapCost = { price: 1, quote: 2 };
export const ONEINCH_COST: SwapCost = { price: 1, quote: 1 };

export function budgetedSwap(swap: SwapSource, rule: BucketRule = defaultSwapBudget, now?: () => number, cost: SwapCost = KYBER_COST): SwapSource {
  const budget = createBucketStore(rule, now);

  function spend(n: number): void {
    const result = budget.take("swap", n);
    if (!result.ok) {
      const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      throw new SwapError("RATE_LIMITED", `Too many swap quotes right now. Try again in ${seconds} s.`, { retryAfterSeconds: seconds });
    }
  }

  return {
    async price(p) {
      spend(cost.price);
      return swap.price(p);
    },
    async quote(p) {
      spend(cost.quote);
      return swap.quote(p);
    },
  };
}

/** The same budget around one provider, keeping its name, target and spender (BE-51: each provider has its own). */
export function budgetedProvider(provider: SwapProvider, rule: BucketRule, cost: SwapCost, now?: () => number): SwapProvider {
  return { ...budgetedSwap(provider, rule, now, cost), name: provider.name, target: provider.target, spender: provider.spender };
}
