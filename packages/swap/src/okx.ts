import { createHmac } from "node:crypto";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { createHttp, type HttpOptions } from "./http";
import { SwapError, type SwapProvider } from "./types";

export const OKX_API_URL = "https://web3.okx.com";

const amount = z.string().regex(/^\d+$/);
const envelope = z.object({ code: z.union([z.string(), z.number()]), msg: z.string().optional(), data: z.array(z.unknown()).optional() });
const quoteData = z.object({ toTokenAmount: amount });
const swapData = z.object({
  routerResult: z.object({ toTokenAmount: amount }),
  tx: z.object({ to: z.string(), data: z.string().regex(/^0x[0-9a-fA-F]*$/), value: amount }),
});

export type OkxOptions = Omit<HttpOptions, "name"> & {
  chainId: number;
  apiKey: string;
  secretKey: string;
  passphrase: string;
  /** The DEX router the answer must name (`tx.to`). */
  router: Address;
  /** The contract that pulls the input token, which our router approves (D-88). */
  approve: Address;
  baseUrl?: string;
  /** Clock for the request signature, ISO 8601. */
  timestamp?: () => string;
};

/**
 * OKX DEX API v6 (D-53, D-85), the main route on X Layer. Each request is signed with HMAC-SHA256 over the timestamp,
 * method, path and query. Our ISPs redirect `web3.okx.com` by DNS (05), so it is called from the VPS. A plain client
 * name is sent as the User-Agent. The default gap of 1.1 s is an initial proposal; OKX's limit for our key is not
 * verified.
 */
export function createOkx({
  chainId,
  apiKey,
  secretKey,
  passphrase,
  router,
  approve,
  baseUrl = OKX_API_URL,
  timestamp = () => new Date().toISOString(),
  minGapMs = 1_100,
  ...http
}: OkxOptions): SwapProvider {
  const request = createHttp({ name: "OKX DEX", minGapMs, ...http });

  async function call(path: "quote" | "swap", params: Record<string, string>): Promise<unknown> {
    const query = `/api/v6/dex/aggregator/${path}?${new URLSearchParams({ chainIndex: String(chainId), ...params })}`;
    const ts = timestamp();
    const headers = {
      "OK-ACCESS-KEY": apiKey,
      "OK-ACCESS-SIGN": createHmac("sha256", secretKey).update(`${ts}GET${query}`).digest("base64"),
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": passphrase,
      accept: "application/json",
      "user-agent": "levra-backend/1.0",
    };
    const { status, body } = await request(`${baseUrl}${query}`, { headers });
    const parsed = envelope.safeParse(body);
    const code = parsed.success ? String(parsed.data.code) : "";
    const reason = parsed.data?.msg ?? "";
    // OKX answers HTTP 200 with its own code; 50011 is its rate limit.
    if (code === "50011") throw new SwapError("RATE_LIMITED", "OKX DEX is rate limiting us. Try again shortly.");
    if (status === 200 && code === "0" && parsed.data?.data?.[0] !== undefined) return parsed.data.data[0];
    if (/liquidity|route/i.test(reason)) throw new SwapError("NO_ROUTE", "No swap route for this size right now.", { code, reason });
    throw new SwapError("UPSTREAM_ERROR", `OKX DEX answered ${status} with code ${code || "none"}.`, { code, reason });
  }

  const pair = (p: { tokenIn: Address; tokenOut: Address; amountIn: bigint }) => ({ fromTokenAddress: p.tokenIn, toTokenAddress: p.tokenOut, amount: p.amountIn.toString() });

  return {
    name: "okx",
    target: router,
    spender: approve,

    async price(p) {
      const parsed = quoteData.safeParse(await call("quote", pair(p)));
      if (!parsed.success) throw new SwapError("UPSTREAM_ERROR", "Unexpected answer from OKX DEX.");
      return BigInt(parsed.data.toTokenAmount);
    },

    async quote(p) {
      if (p.slippageBps < 0 || p.slippageBps >= 10_000) throw new SwapError("UPSTREAM_ERROR", "Slippage must be below 100%.");
      const parsed = swapData.safeParse(
        await call("swap", {
          ...pair(p),
          // OKX takes the slippage in percent. Our contract sends and receives, as OKX's docs ask.
          slippagePercent: (p.slippageBps / 100).toString(),
          userWalletAddress: p.sender,
          swapReceiverAddress: p.sender,
        }),
      );
      if (!parsed.success) throw new SwapError("UPSTREAM_ERROR", "Unexpected answer from OKX DEX.");
      const { tx, routerResult } = parsed.data;
      if (tx.to.toLowerCase() !== router.toLowerCase()) throw new SwapError("UPSTREAM_ERROR", "OKX DEX answered with a router we do not allow.");
      if (tx.value !== "0") throw new SwapError("UPSTREAM_ERROR", "OKX DEX asked for native value in a token swap.");
      return { amountIn: p.amountIn, amountOut: BigInt(routerResult.toTokenAmount), data: tx.data as Hex, target: router };
    },
  };
}
