import { apiError } from "@levra/shared/api";

/** The Levra API as the agent sees it: public reads, quotes and prepared actions. No keys, no sign-in. */
export type LevraApi = {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
};

export class LevraApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type ApiOptions = { fetchFn?: typeof fetch; timeoutMs?: number; headers?: Record<string, string> };

export function createLevraApi(baseUrl: string, { fetchFn = fetch, timeoutMs = 25_000, headers = {} }: ApiOptions = {}): LevraApi {
  async function call(path: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new LevraApiError("UPSTREAM_ERROR", "The Levra API did not answer. Try again shortly.");
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) return body;
    const err = apiError.safeParse(body);
    if (err.success) throw new LevraApiError(err.data.error.code, err.data.error.message);
    throw new LevraApiError("UPSTREAM_ERROR", `The Levra API answered ${res.status}.`);
  }
  return {
    get: (path) => call(path, { headers: { ...headers, accept: "application/json" } }),
    post: (path, body) => call(path, { method: "POST", headers: { ...headers, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }),
  };
}
