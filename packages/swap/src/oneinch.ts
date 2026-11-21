import type { Address, Hex } from "viem";
import { z } from "zod";
import { createHttp, type HttpOptions } from "./http";
import { SwapError, type SwapProvider } from "./types";

export const ONEINCH_API_URL = "https://api.1inch.dev";

const quoteResponse = z.object({ dstAmount: z.string().regex(/^\d+$/) });
const swapResponse = z.object({
  dstAmount: z.string().regex(/^\d+$/),
  tx: z.object({ to: z.string(), data: z.string().regex(/^0x[0-9a-fA-F]*$/), value: z.string().regex(/^\d+$/) }),
});
const errorResponse = z.object({ description: z.string().optional(), error: z.string().optional() }).passthrough();

export type OneInchOptions = Omit<HttpOptions, "name"> & {
  chainId: number;
  /** 1inch Business API key, sent as a bearer token. */
  apiKey: string;
  /** The AggregationRouterV6 the answer must name (05). */
  router: Address;
  baseUrl?: string;
};

/**
 * 1inch Swap API v6.0 (D-72, D-80). Its CDN refuses script-like User-Agents (Cloudflare 1010, 05), so a plain client
 * name is sent. The default gap of 1.1 s stays under the 1 request per second of the entry plan.
 */
export function createOneInch({ chainId, apiKey, router, baseUrl = ONEINCH_API_URL, minGapMs = 1_100, ...http }: OneInchOptions): SwapProvider {
  const request = createHttp({ name: "1inch", minGapMs, ...http });
  const headers = { authorization: `Bearer ${apiKey}`, accept: "application/json", "user-agent": "levra-backend/1.0" };

  async function call(path: "quote" | "swap", params: Record<string, string>): Promise<unknown> {
    const { status, body } = await request(`${baseUrl}/swap/v6.0/${chainId}/${path}?${new URLSearchParams(params)}`, { headers });
    if (status === 200) return body;
    const reason = errorResponse.safeParse(body).data?.description ?? "";
    // 1inch answers 400 when it finds no route or liquidity for the pair and size.
    if (status === 400 && /liquidity|route|amount/i.test(reason)) throw new SwapError("NO_ROUTE", "No swap route for this size right now.", { reason });
    throw new SwapError("UPSTREAM_ERROR", `1inch answered ${status}.`, { reason });
  }

  const pair = (p: { tokenIn: Address; tokenOut: Address; amountIn: bigint }) => ({ src: p.tokenIn, dst: p.tokenOut, amount: p.amountIn.toString() });

  return {
    name: "1inch",
    target: router,
    spender: router,

    async price(p) {
      const parsed = quoteResponse.safeParse(await call("quote", pair(p)));
      if (!parsed.success) throw new SwapError("UPSTREAM_ERROR", "Unexpected answer from 1inch.");
      return BigInt(parsed.data.dstAmount);
    },

    async quote(p) {
      const parsed = swapResponse.safeParse(
        await call("swap", {
          ...pair(p),
          from: p.sender,
          receiver: p.sender,
          // 1inch takes the slippage in percent.
          slippage: (p.slippageBps / 100).toString(),
          // The sender is a contract that holds nothing yet, so 1inch cannot estimate gas.
          disableEstimate: "true",
          allowPartialFill: "false",
        }),
      );
      if (!parsed.success) throw new SwapError("UPSTREAM_ERROR", "Unexpected answer from 1inch.");
      const { tx, dstAmount } = parsed.data;
      if (tx.to.toLowerCase() !== router.toLowerCase()) throw new SwapError("UPSTREAM_ERROR", "1inch answered with a router we do not allow.");
      if (tx.value !== "0") throw new SwapError("UPSTREAM_ERROR", "1inch asked for native value in a token swap.");
      return { amountIn: p.amountIn, amountOut: BigInt(dstAmount), data: tx.data as Hex, target: router };
    },
  };
}
