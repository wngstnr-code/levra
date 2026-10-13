/** A token bucket: `capacity` requests at once, refilled at `perMinute` requests per minute. */
export type BucketRule = { capacity: number; perMinute: number };

export type TakeResult = { ok: true } | { ok: false; retryAfterMs: number };

export type BucketStore = {
  take(key: string, cost?: number): TakeResult;
  size(): number;
};

type Bucket = { tokens: number; at: number };

/**
 * In-memory buckets, one per key. Fine for one API instance; several instances would need a shared
 * store. When more than `maxKeys` keys exist, buckets that have refilled completely are dropped,
 * since a full bucket carries no state.
 */
export function createBucketStore(rule: BucketRule, now: () => number = Date.now, maxKeys = 50_000): BucketStore {
  if (rule.capacity < 1 || rule.perMinute <= 0) throw new Error("a bucket needs a capacity of at least 1 and a positive refill");
  const perMs = rule.perMinute / 60_000;
  const buckets = new Map<string, Bucket>();

  function refill(bucket: Bucket, t: number): number {
    return Math.min(rule.capacity, bucket.tokens + (t - bucket.at) * perMs);
  }

  function sweep(t: number): void {
    for (const [key, bucket] of buckets) {
      if (refill(bucket, t) >= rule.capacity) buckets.delete(key);
    }
  }

  return {
    take(key, cost = 1) {
      const t = now();
      const existing = buckets.get(key);
      const tokens = existing ? refill(existing, t) : rule.capacity;
      if (tokens < cost) {
        buckets.set(key, { tokens, at: t });
        return { ok: false, retryAfterMs: Math.ceil((cost - tokens) / perMs) };
      }
      if (!existing && buckets.size >= maxKeys) sweep(t);
      buckets.set(key, { tokens: tokens - cost, at: t });
      return { ok: true };
    },
    size: () => buckets.size,
  };
}
