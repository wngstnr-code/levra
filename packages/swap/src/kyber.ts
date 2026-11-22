import { external } from "@levra/shared/addresses";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { createHttp, type HttpOptions } from "./http";
import { SwapError, type SwapProvider } from "./types";

export const KYBER_MONAD_URL = "https://aggregator-api.kyberswap.com/monad/api/v1";
export const KYBER_BASE_URL = "https://aggregator-api.kyberswap.com/base/api/v1";

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

export type KyberOptions = Omit<HttpOptions, "name"> & {
  baseUrl: string;
  clientId: string;
  /** Sent as X-Api-Key; KyberSwap gives keys for higher limits on its gateway (05). */
  apiKey?: string;
  /** The MetaAggregationRouterV2 the answer must name. The same address on Monad and Base (05). */
  router?: Address;
};

/** KyberSwap aggregator. The public limit is about 3 requests per second (05), hence the 350 ms default gap. */
export function createKyber({ baseUrl, clientId, apiKey, router = external.kyberRouter, ...http }: KyberOptions): SwapProvider {
  const request = createHttp({ name: "The swap aggregator", ...http });
  const headers = { "x-client-id": clientId, ...(apiKey ? { "x-api-key": apiKey } : {}), "content-type": "application/json" };

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const { status, body } = await request(`${baseUrl}${path}`, { ...init, headers });
    if (status >= 300 && status !== 400 && status !== 404) throw new SwapError("UPSTREAM_ERROR", `The swap aggregator answered ${status}.`, body);
    return body;
  }

  const checkRouter = (address: string) => {
    if (address.toLowerCase() !== router.toLowerCase()) throw new SwapError("UPSTREAM_ERROR", "The swap aggregator answered with a router we do not allow.");
  };

  async function route(tokenIn: Address, tokenOut: Address, amountIn: bigint) {
    const parsed = routeResponse.safeParse(await call(`/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn.toString()}`));
    if (!parsed.success) throw new SwapError("UPSTREAM_ERROR", "Unexpected answer from the swap aggregator.");
    if (parsed.data.code !== 0 || !parsed.data.data) throw new SwapError("NO_ROUTE", "No swap route for this size right now.", { reason: parsed.data.message });
    checkRouter(parsed.data.data.routerAddress);
    return parsed.data.data.routeSummary;
  }

  return {
    name: "kyberswap",
    target: router,
    spender: router,

    async price({ tokenIn, tokenOut, amountIn }) {
      return BigInt((await route(tokenIn, tokenOut, amountIn)).amountOut);
    },

    async quote({ tokenIn, tokenOut, amountIn, sender, slippageBps }) {
      const routeSummary = await route(tokenIn, tokenOut, amountIn);
      const parsed = buildResponse.safeParse(
        await call("/route/build", { method: "POST", body: JSON.stringify({ routeSummary, sender, recipient: sender, slippageTolerance: slippageBps }) }),
      );
      if (!parsed.success) throw new SwapError("UPSTREAM_ERROR", "Unexpected answer from the swap aggregator.");
      if (parsed.data.code !== 0 || !parsed.data.data) throw new SwapError("NO_ROUTE", "The swap aggregator could not build this route.", { reason: parsed.data.message });
      const built = parsed.data.data;
      checkRouter(built.routerAddress);
      return { amountIn: BigInt(built.amountIn), amountOut: BigInt(built.amountOut), data: built.data as Hex, target: router };
    },
  };
}
