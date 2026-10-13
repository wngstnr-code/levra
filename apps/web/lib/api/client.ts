import { apiError, endpoints, type ApiErrorCode } from "@levra/shared/api";
import type { z } from "zod";

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") || null;

/** The service address is not configured, so nothing can be asked. */
export class ApiUnavailableError extends Error {
  constructor() {
    super("The Levra service is not configured.");
    this.name = "ApiUnavailableError";
  }
}

export class ApiRequestError extends Error {
  constructor(
    readonly code: ApiErrorCode | "NETWORK" | "BAD_RESPONSE",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type Endpoints = typeof endpoints;
export type EndpointName = keyof Endpoints;
export type ApiResponse<N extends EndpointName> = Endpoints[N] extends { response: infer R extends z.ZodType } ? z.infer<R> : never;
export type ApiBody<N extends EndpointName> = Endpoints[N] extends { body: infer B extends z.ZodType } ? z.input<B> : never;

type Options<N extends EndpointName> = {
  params?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: ApiBody<N>;
  token?: string;
  signal?: AbortSignal;
};

export function endpointUrl(path: string, params: Record<string, string> = {}, query: Options<EndpointName>["query"] = {}): string {
  if (!apiBaseUrl) throw new ApiUnavailableError();
  const filled = path.replace(/:([a-zA-Z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ""));
  const qs = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${apiBaseUrl}${filled}${qs ? `?${qs}` : ""}`;
}

/** Calls one endpoint and validates the answer against its shared schema. */
export async function api<N extends EndpointName>(name: N, opts: Options<N> = {}): Promise<ApiResponse<N>> {
  const ep = endpoints[name] as { method: string; path: string; response?: z.ZodType };
  const url = endpointUrl(ep.path, opts.params, opts.query);
  let res: Response;
  try {
    res = await fetch(url, {
      method: ep.method,
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiRequestError("NETWORK", "The Levra service could not be reached.");
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = apiError.safeParse(json);
    if (parsed.success) throw new ApiRequestError(parsed.data.error.code, parsed.data.error.message, res.status);
    throw new ApiRequestError("BAD_RESPONSE", `The service answered with status ${res.status}.`, res.status);
  }
  if (!ep.response) return json as ApiResponse<N>;
  const parsed = ep.response.safeParse(json);
  if (!parsed.success) throw new ApiRequestError("BAD_RESPONSE", "The service sent data in an unexpected shape.", res.status);
  return parsed.data as ApiResponse<N>;
}
