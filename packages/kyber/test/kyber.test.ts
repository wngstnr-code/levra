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

  it("returns the route output", async () => {
    expect(await createKyber({ baseUrl: "x", clientId: "levra", fetchFn: respond(200, ok) }).price({ tokenIn: usdc, tokenOut: stock, amountIn: 1n })).toBe(2n);
  });

  it.each([
    [429, {}, "RATE_LIMITED"],
    [200, { code: 4008, message: "route not found" }, "NO_ROUTE"],
    [500, {}, "UPSTREAM_ERROR"],
    [200, { ...ok, data: { ...ok.data, routerAddress: "0x0000000000000000000000000000000000000001" } }, "UPSTREAM_ERROR"],
  ])("answers %i with %s", async (status, body, code) => {
    const kyber = createKyber({ baseUrl: "x", clientId: "levra", fetchFn: respond(status, body) });
    await expect(kyber.price({ tokenIn: usdc, tokenOut: stock, amountIn: 1n })).rejects.toBeInstanceOf(SwapError);
    await expect(kyber.price({ tokenIn: usdc, tokenOut: stock, amountIn: 1n })).rejects.toMatchObject({ code });
  });
});
