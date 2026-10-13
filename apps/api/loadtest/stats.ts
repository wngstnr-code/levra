/** Nearest-rank percentile of `values`, `p` from 0 to 100. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export class Tally {
  readonly counts = new Map<string, number>();

  add(key: string, n = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }

  total(): number {
    let sum = 0;
    for (const n of this.counts.values()) sum += n;
    return sum;
  }

  toObject(): Record<string, number> {
    return Object.fromEntries([...this.counts].sort(([, a], [, b]) => b - a));
  }
}

/** Counts outgoing HTTP requests, and the JSON-RPC calls inside them (a batch carries several). */
export class OutboundCounter {
  requests = 0;
  readonly methods = new Tally();

  wrap(fetchFn: typeof fetch = fetch): typeof fetch {
    return (input, init) => {
      this.requests++;
      this.countBody(init?.body);
      return fetchFn(input, init);
    };
  }

  countBody(body: unknown): void {
    if (typeof body !== "string") return;
    try {
      const parsed: unknown = JSON.parse(body);
      for (const call of Array.isArray(parsed) ? parsed : [parsed]) {
        const method = typeof call === "object" && call !== null ? (call as { method?: unknown }).method : undefined;
        if (typeof method === "string") this.methods.add(method);
      }
    } catch {
      // Not JSON-RPC (a KyberSwap build body, for example); the HTTP request is still counted.
    }
  }
}

export type RouteStats = { count: number; statuses: Record<string, number>; p50Ms: number; p95Ms: number; p99Ms: number };

export class RouteRecorder {
  private readonly latencies = new Map<string, number[]>();
  private readonly statuses = new Map<string, Tally>();

  record(route: string, status: number | "error", ms: number): void {
    const list = this.latencies.get(route) ?? [];
    list.push(ms);
    this.latencies.set(route, list);
    const tally = this.statuses.get(route) ?? new Tally();
    tally.add(String(status));
    this.statuses.set(route, tally);
  }

  clear(): void {
    this.latencies.clear();
    this.statuses.clear();
  }

  summary(): Record<string, RouteStats> {
    const out: Record<string, RouteStats> = {};
    for (const [route, list] of [...this.latencies].sort(([a], [b]) => a.localeCompare(b))) {
      out[route] = {
        count: list.length,
        statuses: this.statuses.get(route)?.toObject() ?? {},
        p50Ms: Math.round(percentile(list, 50)),
        p95Ms: Math.round(percentile(list, 95)),
        p99Ms: Math.round(percentile(list, 99)),
      };
    }
    return out;
  }
}
