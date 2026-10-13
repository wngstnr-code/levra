import { external } from "@levra/shared/addresses";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { ApiHttpError } from "../errors";

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
  /** Output for `amountIn` without building calldata. Used for the DEX mid price. */
  price(p: { tokenIn: Address; tokenOut: Address; amountIn: bigint }): Promise<bigint>;
};

export type KyberOptions = { baseUrl: string; clientId: string; timeoutMs?: number; fetchFn?: typeof fetch };

export function createKyber({ baseUrl, clientId, timeoutMs = 8_000, fetchFn = fetch }: KyberOptions): SwapSource {
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        headers: { "x-client-id": clientId, "content-type": "application/json", ...init?.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ApiHttpError("UPSTREAM_ERROR", "The swap aggregator did not answer.", undefined, err);
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 429) throw new ApiHttpError("RATE_LIMITED", "The swap aggregator is rate limiting us. Try again shortly.");
    if (!res.ok && res.status !== 400 && res.status !== 404) {
      throw new ApiHttpError("UPSTREAM_ERROR", `The swap aggregator answered ${res.status}.`, undefined, body);
    }
    return body;
  }

  async function route(tokenIn: Address, tokenOut: Address, amountIn: bigint) {
    const parsed = routeResponse.safeParse(
      await request(`/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn.toString()}`),
    );
    if (!parsed.success) throw new ApiHttpError("UPSTREAM_ERROR", "Unexpected answer from the swap aggregator.");
    if (parsed.data.code !== 0 || !parsed.data.data) {
      throw new ApiHttpError("NO_ROUTE", "No swap route for this size right now.", { reason: parsed.data.message });
    }
    if (parsed.data.data.routerAddress.toLowerCase() !== external.kyberRouter.toLowerCase()) {
      throw new ApiHttpError("UPSTREAM_ERROR", "The swap aggregator answered with a router we do not allow.");
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
      if (!parsed.success) throw new ApiHttpError("UPSTREAM_ERROR", "Unexpected answer from the swap aggregator.");
      if (parsed.data.code !== 0 || !parsed.data.data) {
        throw new ApiHttpError("NO_ROUTE", "The swap aggregator could not build this route.", { reason: parsed.data.message });
      }
      const built = parsed.data.data;
      if (built.routerAddress.toLowerCase() !== external.kyberRouter.toLowerCase()) {
        throw new ApiHttpError("UPSTREAM_ERROR", "The swap aggregator answered with a router we do not allow.");
      }
      return { amountIn: BigInt(built.amountIn), amountOut: BigInt(built.amountOut), data: built.data as Hex, target: external.kyberRouter };
    },
  };
}
