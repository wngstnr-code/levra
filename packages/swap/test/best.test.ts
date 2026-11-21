import { describe, expect, it } from "vitest";
import { SwapError, bestRoute, type SwapProvider } from "../src/index";

const a = "0x0000000000000000000000000000000000000a01";
const b = "0x0000000000000000000000000000000000000b02";
const sender = "0x00000000000000000000000000000000Ce751d01";

function provider(name: string, out: bigint | SwapError): SwapProvider {
  const target = `0x${name.charCodeAt(0).toString(16).padStart(40, "0")}` as const;
  return {
    name,
    target,
    spender: target,
    price: async () => {
      if (out instanceof SwapError) throw out;
      return out;
    },
    quote: async (p) => {
      if (out instanceof SwapError) throw out;
      return { amountIn: p.amountIn, amountOut: out, data: "0x", target };
    },
  };
}
const quoteOf = (providers: SwapProvider[]) => bestRoute(providers).quote({ tokenIn: a, tokenOut: b, amountIn: 10n, sender, slippageBps: 50 });

describe("best route", () => {
  it("keeps the largest output, for quotes and prices", async () => {
    const providers = [provider("k", 100n), provider("o", 103n), provider("a", 101n)];
    expect((await quoteOf(providers)).target).toBe(providers[1]!.target);
    expect(await bestRoute(providers).price({ tokenIn: a, tokenOut: b, amountIn: 10n })).toBe(103n);
  });

  it("falls back to the next provider when one fails or offers nothing", async () => {
    const providers = [provider("k", new SwapError("UPSTREAM_ERROR", "down")), provider("o", 0n), provider("a", 99n)];
    expect((await quoteOf(providers)).amountOut).toBe(99n);
  });

  it("answers NO_ROUTE when every provider has no route", async () => {
    await expect(quoteOf([provider("k", new SwapError("NO_ROUTE", "x")), provider("o", 0n)])).rejects.toMatchObject({ code: "NO_ROUTE" });
  });

  it("answers RATE_LIMITED when a provider is rate limited and none answered", async () => {
    await expect(quoteOf([provider("k", new SwapError("NO_ROUTE", "x")), provider("o", new SwapError("RATE_LIMITED", "slow"))])).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("answers UPSTREAM_ERROR for anything else", async () => {
    const plain = { ...provider("k", 1n), quote: async () => { throw new Error("boom"); } };
    await expect(quoteOf([plain, provider("o", new SwapError("NO_ROUTE", "x"))])).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("needs at least one provider", () => {
    expect(() => bestRoute([])).toThrow();
  });
});
