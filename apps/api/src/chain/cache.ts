type Entry<T> = { value: T; expiresAt: number } | { pending: Promise<T> };

/** Keeps each value for `ttlMs` and shares one in-flight request between callers, so bursts cost one RPC call. */
export function createCache(now: () => number = Date.now) {
  const entries = new Map<string, Entry<unknown>>();

  return async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const entry = entries.get(key) as Entry<T> | undefined;
    if (entry && "pending" in entry) return entry.pending;
    if (entry && entry.expiresAt > now()) return entry.value;

    const pending = load().then(
      (value) => {
        entries.set(key, { value, expiresAt: now() + ttlMs });
        return value;
      },
      (err: unknown) => {
        entries.delete(key);
        throw err;
      },
    );
    entries.set(key, { pending });
    return pending;
  };
}

export type Cached = ReturnType<typeof createCache>;
