import { describe, expect, it } from "vitest";
import { SwapError, createOneInch } from "../src/index";

const router = "0x111111125421cA6dc452d289314280a0f8842A65";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const nvda = "0xb20000000000000000000078ee7ce2fE4908108C";
const sender = "0x00000000000000000000000000000000Ce751d01";

type Seen = { url: URL; headers: Headers };
function fake(status: number, body: unknown, seen: Seen[] = []) {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url: new URL(url), headers: new Headers(init.headers) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}
const oneInch = (fetchFn: typeof fetch) => createOneInch({ chainId: 8453, apiKey: "k", router, fetchFn, minGapMs: 0, sleep: async () => {} });
const swapBody = { dstAmount: "1300000", tx: { to: router, data: "0x12aa3caf", value: "0" } };

describe("1inch client", () => {
  it("prices through /quote with the key and a plain User-Agent", async () => {
    const seen: Seen[] = [];
    expect(await oneInch(fake(200, { dstAmount: "42" }, seen)).price({ tokenIn: usdc, tokenOut: nvda, amountIn: 100n })).toBe(42n);
    expect(seen[0]!.url.pathname).toBe("/swap/v6.0/8453/quote");
    expect(Object.fromEntries(seen[0]!.url.searchParams)).toEqual({ src: usdc, dst: nvda, amount: "100" });
    expect(seen[0]!.headers.get("authorization")).toBe("Bearer k");
    expect(seen[0]!.headers.get("user-agent")).toBe("levra-backend/1.0");
  });

  it("builds a swap for a contract sender and receiver, with the slippage in percent", async () => {
    const seen: Seen[] = [];
    const q = await oneInch(fake(200, swapBody, seen)).quote({ tokenIn: usdc, tokenOut: nvda, amountIn: 1_000_000n, sender, slippageBps: 75 });
    expect(q).toEqual({ amountIn: 1_000_000n, amountOut: 1_300_000n, data: "0x12aa3caf", target: router });
    const params = seen[0]!.url.searchParams;
    expect(params.get("from")).toBe(sender);
    expect(params.get("receiver")).toBe(sender);
    expect(params.get("slippage")).toBe("0.75");
    expect(params.get("disableEstimate")).toBe("true");
    expect(params.get("allowPartialFill")).toBe("false");
  });

  it("refuses a swap to another router or with native value", async () => {
    await expect(oneInch(fake(200, { ...swapBody, tx: { ...swapBody.tx, to: "0x0000000000000000000000000000000000000001" } })).quote({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n, sender, slippageBps: 50 })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    await expect(oneInch(fake(200, { ...swapBody, tx: { ...swapBody.tx, value: "1" } })).quote({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n, sender, slippageBps: 50 })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it.each([
    [400, { error: "Bad Request", description: "insufficient liquidity" }, "NO_ROUTE"],
    [400, { error: "Bad Request", description: "src is not valid" }, "UPSTREAM_ERROR"],
    [401, { description: "Unauthorized" }, "UPSTREAM_ERROR"],
    [429, {}, "RATE_LIMITED"],
    [500, {}, "UPSTREAM_ERROR"],
    [200, { amount: "1" }, "UPSTREAM_ERROR"],
  ])("answers %i %j with %s", async (status, body, code) => {
    const p = oneInch(fake(status, body)).price({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n });
    await expect(p).rejects.toBeInstanceOf(SwapError);
    await expect(oneInch(fake(status, body)).price({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n })).rejects.toMatchObject({ code });
  });
});
