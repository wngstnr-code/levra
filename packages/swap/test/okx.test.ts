import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOkx, SwapError } from "../src/index";

const router = "0x7c5bEE2a8091C3ef39072f64F18Fac913060AEaF";
const approve = "0x8b773D83bc66Be128c60e07E17C8901f7a64F000";
const usdc = "0xB6CEceAB302E2E4948951eE7843FC24E92933061";
const nvda = "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5";
const sender = "0x00000000000000000000000000000000Ce751d01";
const TS = "2026-11-23T04:00:00.000Z";

type Seen = { url: URL; headers: Headers };
function fake(status: number, body: unknown, seen: Seen[] = []) {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url: new URL(url), headers: new Headers(init.headers) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}
const okx = (fetchFn: typeof fetch) =>
  createOkx({ chainId: 196, apiKey: "k", secretKey: "s", passphrase: "p", router, approve, fetchFn, minGapMs: 0, sleep: async () => {}, timestamp: () => TS });
const ok = (data: unknown) => ({ code: "0", msg: "", data: [data] });
const swapData = { routerResult: { toTokenAmount: "1300000000000000000" }, tx: { to: router, data: "0xf2c42696", value: "0", minReceiveAmount: "1287000000000000000" } };

describe("OKX DEX client", () => {
  it("prices through the v6 quote endpoint, signed over timestamp, method, path and query", async () => {
    const seen: Seen[] = [];
    expect(await okx(fake(200, ok({ toTokenAmount: "42" }), seen)).price({ tokenIn: usdc, tokenOut: nvda, amountIn: 100n })).toBe(42n);
    const { url, headers } = seen[0]!;
    expect(url.pathname).toBe("/api/v6/dex/aggregator/quote");
    expect(Object.fromEntries(url.searchParams)).toEqual({ chainIndex: "196", fromTokenAddress: usdc, toTokenAddress: nvda, amount: "100" });
    expect(headers.get("OK-ACCESS-KEY")).toBe("k");
    expect(headers.get("OK-ACCESS-PASSPHRASE")).toBe("p");
    expect(headers.get("OK-ACCESS-TIMESTAMP")).toBe(TS);
    expect(headers.get("OK-ACCESS-SIGN")).toBe(createHmac("sha256", "s").update(`${TS}GET${url.pathname}${url.search}`).digest("base64"));
    expect(headers.get("user-agent")).toBe("levra-backend/1.0");
  });

  it("builds a swap with our contract as sender and receiver, the slippage in percent, and the approve contract as spender", async () => {
    const seen: Seen[] = [];
    const provider = okx(fake(200, ok(swapData), seen));
    expect([provider.target, provider.spender]).toEqual([router, approve]);
    const q = await provider.quote({ tokenIn: usdc, tokenOut: nvda, amountIn: 200_000_000n, sender, slippageBps: 100 });
    expect(q).toEqual({ amountIn: 200_000_000n, amountOut: 1_300_000_000_000_000_000n, data: "0xf2c42696", target: router });
    const params = seen[0]!.url.searchParams;
    expect(seen[0]!.url.pathname).toBe("/api/v6/dex/aggregator/swap");
    expect(params.get("userWalletAddress")).toBe(sender);
    expect(params.get("swapReceiverAddress")).toBe(sender);
    expect(params.get("slippagePercent")).toBe("1");
  });

  it("refuses a swap to another router, with native value, or with a bad slippage", async () => {
    const swap = (data: unknown, slippageBps = 50) => okx(fake(200, ok(data))).quote({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n, sender, slippageBps });
    await expect(swap({ ...swapData, tx: { ...swapData.tx, to: approve } })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    await expect(swap({ ...swapData, tx: { ...swapData.tx, value: "1" } })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    await expect(swap(swapData, 10_000)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it.each([
    [200, { code: "82000", msg: "Insufficient liquidity", data: [] }, "NO_ROUTE"],
    [200, { code: "51000", msg: "Parameter amount error", data: [] }, "UPSTREAM_ERROR"],
    [200, { code: "50011", msg: "Too Many Requests", data: [] }, "RATE_LIMITED"],
    [200, { code: "0", msg: "", data: [] }, "UPSTREAM_ERROR"],
    [200, { code: "0", data: [{ amount: "1" }] }, "UPSTREAM_ERROR"],
    [401, { code: "50113", msg: "Invalid Sign" }, "UPSTREAM_ERROR"],
    [429, {}, "RATE_LIMITED"],
    [500, null, "UPSTREAM_ERROR"],
  ])("answers %i %j with %s", async (status, body, code) => {
    const p = okx(fake(status, body)).price({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n });
    await expect(p).rejects.toBeInstanceOf(SwapError);
    await expect(okx(fake(status, body)).price({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n })).rejects.toMatchObject({ code });
  });
});
