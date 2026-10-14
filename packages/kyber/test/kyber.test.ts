import { external } from "@levra/shared/addresses";
import { describe, expect, it } from "vitest";
import { SwapError, createKyber, dexMidPriceE8, type SwapSource } from "../src/index";

const usdc = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const stock = "0x1446501E886c7f830DB9b494A1890cBCCC072f57";

describe("DEX mid price", () => {
  it("averages a 10 USDC buy and a 10 USDC sell", async () => {
    // Buy gets 0.0099 stock for $10 ($1,010.10 each); selling $10 of stock at the $1,000 reference gets $9.90 ($990 each).
    const swap: SwapSource = {
      quote: async () => {
        throw new Error("not used");
      },
      price: async ({ tokenIn }) => (tokenIn === usdc ? 9_900_000_000_000_000n : 9_900_000n),
    };
    const mid = await dexMidPriceE8(swap, { usdc, stock, usdcDecimals: 6, stockDecimals: 18, refPriceE8: 100_000_000_000n });
    expect(mid).toBe(100_005_050_505n);
  });
});

describe("KyberSwap client", () => {
  const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const ok = { code: 0, data: { routeSummary: { amountIn: "1", amountOut: "2" }, routerAddress: external.kyberRouter } };

  const instant = async () => {};

  it("returns the route output", async () => {
    expect(await createKyber({ baseUrl: "x", clientId: "levra", fetchFn: respond(200, ok) }).price({ tokenIn: usdc, tokenOut: stock, amountIn: 1n })).toBe(2n);
  });

  it("retries once after a 429", async () => {
    const statuses = [429, 200];
    const fetchFn = (async () => {
      const status = statuses.shift()!;
      return new Response(JSON.stringify(status === 200 ? ok : {}), { status });
    }) as unknown as typeof fetch;
    const waits: number[] = [];
    const kyber = createKyber({ baseUrl: "x", clientId: "levra", fetchFn, minGapMs: 0, sleep: async (ms) => void waits.push(ms) });
    expect(await kyber.price({ tokenIn: usdc, tokenOut: stock, amountIn: 1n })).toBe(2n);
    expect(waits).toEqual([1_000]);
  });

  it("spaces parallel requests by the minimum gap", async () => {
    const waits: number[] = [];
    const kyber = createKyber({ baseUrl: "x", clientId: "levra", fetchFn: respond(200, ok), now: () => 0, sleep: async (ms) => void waits.push(ms) });
    await Promise.all([1n, 2n, 3n].map((amountIn) => kyber.price({ tokenIn: usdc, tokenOut: stock, amountIn })));
    // All three are called at time 0: the first starts at once, the others wait for their turn.
    expect(waits).toEqual([350, 700]);
  });

  it("sends the API key only when set", async () => {
    const seen: (string | null)[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("x-api-key"));
      return new Response(JSON.stringify(ok), { status: 200 });
    }) as unknown as typeof fetch;
    await createKyber({ baseUrl: "x", clientId: "levra", fetchFn }).price({ tokenIn: usdc, tokenOut: stock, amountIn: 1n });
    await createKyber({ baseUrl: "x", clientId: "levra", apiKey: "k", fetchFn }).price({ tokenIn: usdc, tokenOut: stock, amountIn: 1n });
    expect(seen).toEqual([null, "k"]);
  });

  it.each([
    [429, {}, "RATE_LIMITED"],
    [200, { code: 4008, message: "route not found" }, "NO_ROUTE"],
    [500, {}, "UPSTREAM_ERROR"],
    [200, { ...ok, data: { ...ok.data, routerAddress: "0x0000000000000000000000000000000000000001" } }, "UPSTREAM_ERROR"],
  ])("answers %i with %s", async (status, body, code) => {
    const kyber = createKyber({ baseUrl: "x", clientId: "levra", fetchFn: respond(status, body), sleep: instant });
    await expect(kyber.price({ tokenIn: usdc, tokenOut: stock, amountIn: 1n })).rejects.toBeInstanceOf(SwapError);
    await expect(kyber.price({ tokenIn: usdc, tokenOut: stock, amountIn: 1n })).rejects.toMatchObject({ code });
  });
});
