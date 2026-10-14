import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import { ApiHttpError } from "../errors";
import { createBucketStore, type BucketRule, type TakeResult } from "./bucket";

export type RateLimitRules = {
  /** Every request from one IP address, except /v1/health. */
  ip: BucketRule;
  /**
   * Quote requests from one IP address: trade quotes call KyberSwap and simulate on chain, deposit and withdrawal quotes
   * call 1Click and store a row, so they cost the most.
   */
  quoteIp: BucketRule;
  /** Quote requests for one wallet (`user`, or `recipient` for a deposit, in the body), from any IP address. */
  quoteWallet: BucketRule;
  /** Account, history and Earn reads of one wallet, from any IP address. */
  accountWallet: BucketRule;
};

/** Initial proposal, not measured against real traffic yet (BE-54). */
export const defaultRateLimitRules: RateLimitRules = {
  ip: { capacity: 120, perMinute: 120 },
  quoteIp: { capacity: 20, perMinute: 40 },
  quoteWallet: { capacity: 10, perMinute: 30 },
  accountWallet: { capacity: 60, perMinute: 60 },
};

export type RateLimitOptions = {
  rules?: RateLimitRules;
  /**
   * Header set by our own proxy with the client address, such as `x-forwarded-for` or `cf-connecting-ip`.
   * Only set it when a proxy we control always writes it; otherwise clients could pick their own address.
   */
  trustProxyHeader?: string;
  now?: () => number;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** Quotes outside /v1/quote/ that also call an outside service. */
const QUOTE_PATHS = new Set(["/v1/deposit/quote", "/v1/withdraw/quote"]);

/** Our proxy appends the address it saw to x-forwarded-for, so the last entry is the one we can trust. */
export function clientIp(c: Context, trustProxyHeader: string | undefined): string {
  if (trustProxyHeader) {
    const value = c.req.header(trustProxyHeader);
    const last = value?.split(",").at(-1)?.trim();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function bodyWallet(c: Context): Promise<string | undefined> {
  try {
    const body: unknown = await c.req.json();
    const fields = typeof body === "object" && body !== null ? (body as { user?: unknown; recipient?: unknown }) : {};
    const user = fields.user ?? fields.recipient;
    return typeof user === "string" && ADDRESS.test(user) ? user.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function pathWallet(path: string): string | undefined {
  const raw = /^\/v1\/(?:accounts|earn)\/([^/]+)/.exec(path)?.[1];
  return raw && ADDRESS.test(raw) ? raw.toLowerCase() : undefined;
}

function tooMany(c: Context, result: Extract<TakeResult, { ok: false }>, what: string): Response {
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  c.header("Retry-After", String(seconds));
  const err = new ApiHttpError("RATE_LIMITED", `Too many ${what}. Try again in ${seconds} s.`, { retryAfterSeconds: seconds });
  return c.json(err.toBody(), err.status);
}

/** Limits per IP address and per wallet. Answers 429 `RATE_LIMITED` in the shared error shape. */
export function rateLimit({ rules = defaultRateLimitRules, trustProxyHeader, now }: RateLimitOptions = {}): MiddlewareHandler {
  const ip = createBucketStore(rules.ip, now);
  const quoteIp = createBucketStore(rules.quoteIp, now);
  const quoteWallet = createBucketStore(rules.quoteWallet, now);
  const accountWallet = createBucketStore(rules.accountWallet, now);

  return async (c, next) => {
    const path = c.req.path;
    if (path === "/v1/health") return next();

    const address = clientIp(c, trustProxyHeader);
    const general = ip.take(address);
    if (!general.ok) return tooMany(c, general, "requests");

    if (c.req.method === "POST" && (path.startsWith("/v1/quote/") || QUOTE_PATHS.has(path))) {
      const byIp = quoteIp.take(address);
      if (!byIp.ok) return tooMany(c, byIp, "quote requests");
      const wallet = await bodyWallet(c);
      if (wallet) {
        const byWallet = quoteWallet.take(wallet);
        if (!byWallet.ok) return tooMany(c, byWallet, "quote requests for this wallet");
      }
    }

    const account = pathWallet(path);
    if (account) {
      const byWallet = accountWallet.take(account);
      if (!byWallet.ok) return tooMany(c, byWallet, "requests for this wallet");
    }

    return next();
  };
}
