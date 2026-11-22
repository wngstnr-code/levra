import { SwapError } from "./types";

export type HttpOptions = {
  /** Shown in errors, for example "KyberSwap". */
  name: string;
  timeoutMs?: number;
  /** Least time between two request starts, in call order, so parallel calls do not burst past the provider's limit. */
  minGapMs?: number;
  /** Wait before the one retry after a 429. */
  retryAfterMs?: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type HttpResponse = { status: number; body: unknown };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A JSON client with its own request budget: spaced starts, one retry after a 429, then RATE_LIMITED. Other statuses
 * are returned for the provider to read, since a 400 often means "no route" rather than a failure.
 */
export function createHttp({ name, timeoutMs = 8_000, minGapMs = 350, retryAfterMs = 1_000, fetchFn = fetch, sleep = realSleep, now = Date.now }: HttpOptions) {
  let nextStartAt = 0;

  async function slot(): Promise<void> {
    const t = now();
    const startAt = Math.max(t, nextStartAt);
    nextStartAt = startAt + minGapMs;
    if (startAt > t) await sleep(startAt - t);
  }

  async function send(url: string, init?: RequestInit): Promise<Response> {
    await slot();
    try {
      return await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new SwapError("UPSTREAM_ERROR", `${name} did not answer.`, undefined, err);
    }
  }

  return async function request(url: string, init?: RequestInit): Promise<HttpResponse> {
    let res = await send(url, init);
    if (res.status === 429) {
      await res.body?.cancel();
      await sleep(retryAfterMs);
      res = await send(url, init);
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 429) throw new SwapError("RATE_LIMITED", `${name} is rate limiting us. Try again shortly.`);
    return { status: res.status, body };
  };
}
