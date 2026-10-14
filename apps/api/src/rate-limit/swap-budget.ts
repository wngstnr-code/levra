import { SwapError, type SwapSource } from "@levra/kyber";
import { createBucketStore, type BucketRule } from "./bucket";

/**
 * One budget for all KyberSwap calls from this API, so no amount of client traffic can use up our
 * quota with KyberSwap. The public limit is 3 requests per second (05) and the client spaces calls
 * 350 ms apart, so a full bucket waits about 4 s at most instead of failing upstream. Initial proposal.
 */
export const defaultSwapBudget: BucketRule = { capacity: 12, perMinute: 60 };

/** HTTP calls to KyberSwap behind each method: a route, plus a build for a quote. */
const COST = { price: 1, quote: 2 } as const;

export function budgetedSwap(swap: SwapSource, rule: BucketRule = defaultSwapBudget, now?: () => number): SwapSource {
  const budget = createBucketStore(rule, now);

  function spend(cost: number): void {
    const result = budget.take("kyber", cost);
    if (!result.ok) {
      const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      throw new SwapError("RATE_LIMITED", `Too many swap quotes right now. Try again in ${seconds} s.`, { retryAfterSeconds: seconds });
    }
  }

  return {
    async price(p) {
      spend(COST.price);
      return swap.price(p);
    },
    async quote(p) {
      spend(COST.quote);
      return swap.quote(p);
    },
  };
}
