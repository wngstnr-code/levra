import { external } from "@levra/shared/addresses";
import type { Address, Hex } from "viem";
import { z } from "zod";

/** KyberSwap aggregator client for Monad, used by the API (quotes) and the keeper (market depth). */

export type SwapErrorCode = "NO_ROUTE" | "RATE_LIMITED" | "UPSTREAM_ERROR";

export class SwapError extends Error {
  constructor(
    readonly code: SwapErrorCode,
    message: string,
    readonly details?: unknown,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

const routeResponse = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z
    .object({
      routeSummary: z.object({ amountIn: z.string(), amountOut: z.string() }).passthrough(),
      routerAddress: z.string(),
    })
    .nullish(),
});

const buildResponse = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z
    .object({
      amountIn: z.string(),
      amountOut: z.string(),
      data: z.string().regex(/^0x[0-9a-fA-F]*$/),
      routerAddress: z.string(),
    })
    .nullish(),
});

export type SwapQuote = {
  amountIn: bigint;
  amountOut: bigint;
  /** Calldata for the aggregator router, with our MarginRouter as sender and recipient. */
  data: Hex;
  target: Address;
};

export type SwapSource = {
  /** Route and calldata for selling `amountIn` of `tokenIn`, executed by `sender`. */
  quote(p: { tokenIn: Address; tokenOut: Address; amountIn: bigint; sender: Address; slippageBps: number }): Promise<SwapQuote>;
  /** Output for `amountIn` without building calldata. Used for the DEX mid price and market depth. */
  price(p: { tokenIn: Address; tokenOut: Address; amountIn: bigint }): Promise<bigint>;
};

export const KYBER_MONAD_URL = "https://aggregator-api.kyberswap.com/monad/api/v1";

/** Size of the two probes behind the DEX mid price: 10 USDC each way. */
export const MID_PROBE_USD_RAW = 10_000_000n;

/**
 * DEX mid price with 8 decimals: the average of a 10 USDC buy and a sell of the stock worth 10 USDC at `refPriceE8`.
 * One-sided probes carry the pool fee and half the spread, so their average is the fair middle.
 */
export async function dexMidPriceE8(
  swap: SwapSource,
  p: { usdc: Address; stock: Address; usdcDecimals: number; stockDecimals: number; refPriceE8: bigint },
): Promise<bigint> {
  const usdcUnit = 10n ** BigInt(p.usdcDecimals);
  const stockUnit = 10n ** BigInt(p.stockDecimals);
  const sellAmount = (MID_PROBE_USD_RAW * 100_000_000n * stockUnit) / (p.refPriceE8 * usdcUnit);
  const [bought, sold] = await Promise.all([
    swap.price({ tokenIn: p.usdc, tokenOut: p.stock, amountIn: MID_PROBE_USD_RAW }),
    swap.price({ tokenIn: p.stock, tokenOut: p.usdc, amountIn: sellAmount }),
  ]);
  if (bought === 0n || sellAmount === 0n) throw new SwapError("NO_ROUTE", "The DEX gave nothing for the mid price probe.");
  const buyPrice = (MID_PROBE_USD_RAW * 100_000_000n * stockUnit) / (bought * usdcUnit);
  const sellPrice = (sold * 100_000_000n * stockUnit) / (sellAmount * usdcUnit);
  return (buyPrice + sellPrice) / 2n;
}

export type KyberOptions = {
  baseUrl: string;
  clientId: string;
  /** Sent as X-Api-Key; KyberSwap gives keys for higher limits on its gateway (05). */
  apiKey?: string;
  timeoutMs?: number;
  /** Least time between two request starts. The public limit is 3 requests per second (05). */
  minGapMs?: number;
  /** Wait before the one retry after a 429. */
  retryAfterMs?: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createKyber({
  baseUrl,
  clientId,
  apiKey,
  timeoutMs = 8_000,
  minGapMs = 350,
  retryAfterMs = 1_000,
  fetchFn = fetch,
  sleep = realSleep,
  now = Date.now,
}: KyberOptions): SwapSource {
  let nextStartAt = 0;

  /** Spaces request starts by `minGapMs`, in call order, so parallel calls do not burst past the limit. */
  async function slot(): Promise<void> {
    const t = now();
    const startAt = Math.max(t, nextStartAt);
    nextStartAt = startAt + minGapMs;
    if (startAt > t) await sleep(startAt - t);
  }

  async function send(path: string, init?: RequestInit): Promise<Response> {
    await slot();
    try {
      return await fetchFn(`${baseUrl}${path}`, {
        ...init,
        headers: { "x-client-id": clientId, ...(apiKey ? { "x-api-key": apiKey } : {}), "content-type": "application/json", ...init?.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new SwapError("UPSTREAM_ERROR", "The swap aggregator did not answer.", undefined, err);
    }
  }

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    let res = await send(path, init);
    if (res.status === 429) {
      await res.body?.cancel();
      await sleep(retryAfterMs);
      res = await send(path, init);
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 429) throw new SwapError("RATE_LIMITED", "The swap aggregator is rate limiting us. Try again shortly.");
    if (!res.ok && res.status !== 400 && res.status !== 404) {
      throw new SwapError("UPSTREAM_ERROR", `The swap aggregator answered ${res.status}.`, body);
    }
    return body;
  }

  async function route(tokenIn: Address, tokenOut: Address, amountIn: bigint) {
    const parsed = routeResponse.safeParse(await request(`/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn.toString()}`));
    if (!parsed.success) throw new SwapError("UPSTREAM_ERROR", "Unexpected answer from the swap aggregator.");
    if (parsed.data.code !== 0 || !parsed.data.data) {
      throw new SwapError("NO_ROUTE", "No swap route for this size right now.", { reason: parsed.data.message });
    }
    if (parsed.data.data.routerAddress.toLowerCase() !== external.kyberRouter.toLowerCase()) {
      throw new SwapError("UPSTREAM_ERROR", "The swap aggregator answered with a router we do not allow.");
    }
    return parsed.data.data.routeSummary;
  }

  return {
    async price({ tokenIn, tokenOut, amountIn }) {
      return BigInt((await route(tokenIn, tokenOut, amountIn)).amountOut);
    },

    async quote({ tokenIn, tokenOut, amountIn, sender, slippageBps }) {
      const routeSummary = await route(tokenIn, tokenOut, amountIn);
      const parsed = buildResponse.safeParse(
        await request("/route/build", {
          method: "POST",
          body: JSON.stringify({ routeSummary, sender, recipient: sender, slippageTolerance: slippageBps }),
        }),
      );
      if (!parsed.success) throw new SwapError("UPSTREAM_ERROR", "Unexpected answer from the swap aggregator.");
      if (parsed.data.code !== 0 || !parsed.data.data) {
        throw new SwapError("NO_ROUTE", "The swap aggregator could not build this route.", { reason: parsed.data.message });
      }
      const built = parsed.data.data;
      if (built.routerAddress.toLowerCase() !== external.kyberRouter.toLowerCase()) {
        throw new SwapError("UPSTREAM_ERROR", "The swap aggregator answered with a router we do not allow.");
      }
      return { amountIn: BigInt(built.amountIn), amountOut: BigInt(built.amountOut), data: built.data as Hex, target: external.kyberRouter };
    },
  };
}
