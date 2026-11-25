import { riskManagerAbi } from "@levra/shared/abis";
import { bestRoute, type SwapProvider } from "@levra/swap";
import { BaseError, encodeErrorResult, ExecutionRevertedError, type Address, type Hex, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import type { QuoteDeps } from "../src/quotes/common";
import { withRouteFallback } from "../src/quotes/fallback";
import { RouteRevert, simulate } from "../src/quotes/simulate";

const USER = "0x00000000000000000000000000000000000000a1" as Address;
const ROUTER = "0x00000000000000000000000000000000000000aa" as Address;
const TOKEN = "0x0000000000000000000000000000000000000001" as Address;

function provider(name: string, out: bigint, data: Hex): SwapProvider & { quotes: number } {
  const target = `0x${name.charCodeAt(0).toString(16).padStart(40, "0")}` as Address;
  const p = {
    name,
    target,
    spender: target,
    quotes: 0,
    price: async () => out,
    async quote({ amountIn }: { amountIn: bigint }) {
      p.quotes++;
      return { amountIn, amountOut: out, data, target };
    },
  };
  return p;
}

/** A node whose gas estimate fails as `failures` says for the swap calldata in the transaction. */
function node(failures: Record<Hex, () => Error>): PublicClient {
  return {
    async estimateGas({ data }: { data: Hex }) {
      const fail = failures[data];
      if (fail) throw fail();
      return 100_000n;
    },
  } as unknown as PublicClient;
}

const reverted = () => new BaseError("estimate failed", { cause: new ExecutionRevertedError({}) });
const softLimit = () => Object.assign(new BaseError("estimate failed"), { data: encodeErrorResult({ abi: riskManagerAbi, errorName: "SoftLimitExceeded", args: [2n, 1n] }) });
const rpcDown = () => new BaseError("fetch failed");

/** A quote that takes one route and simulates the router call carrying its calldata, like the real quote engines. */
function quoteVia(client: PublicClient) {
  return async (deps: QuoteDeps) => {
    const route = await deps.swap.quote({ tokenIn: TOKEN, tokenOut: TOKEN, amountIn: 1n, sender: ROUTER, slippageBps: 100 });
    const sim = await simulate(client, { from: USER, to: ROUTER, data: route.data });
    return { target: route.target, warning: sim.warning?.code ?? null };
  };
}

const depsWith = (providers: SwapProvider[]) => ({ reader: {}, events: {}, swap: bestRoute(providers) }) as unknown as QuoteDeps;

describe("quote route fallback (BE-102)", () => {
  it("quotes again with the next provider when the best route reverts, and reports the failed one", async () => {
    const best = provider("k", 105n, "0xbad1");
    const next = provider("a", 100n, "0x0001");
    const failed: Address[] = [];
    const result = await withRouteFallback(depsWith([best, next]), quoteVia(node({ "0xbad1": reverted })), (target) => failed.push(target));
    expect(result).toEqual({ target: next.target, warning: null });
    expect(failed).toEqual([best.target]);
  });

  it("keeps a known contract error as a blocking warning, without switching providers", async () => {
    const best = provider("k", 105n, "0x5011");
    const next = provider("a", 100n, "0x0001");
    const result = await withRouteFallback(depsWith([best, next]), quoteVia(node({ "0x5011": softLimit })));
    expect(result).toEqual({ target: best.target, warning: "NEAR_SOFT_LIMIT" });
    expect([best.quotes, next.quotes]).toEqual([1, 1]);
  });

  it("does not switch providers when the node itself fails", async () => {
    const best = provider("k", 105n, "0xbad1");
    const next = provider("a", 100n, "0x0001");
    const err = await withRouteFallback(depsWith([best, next]), quoteVia(node({ "0xbad1": rpcDown }))).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(RouteRevert);
    expect(err).toMatchObject({ code: "UPSTREAM_ERROR" });
    expect([best.quotes, next.quotes]).toEqual([1, 1]);
  });

  it("answers the first failure when every route reverts", async () => {
    const providers = [provider("k", 105n, "0xbad1"), provider("a", 100n, "0xbad2")];
    const failed: Address[] = [];
    const err = await withRouteFallback(depsWith(providers), quoteVia(node({ "0xbad1": reverted, "0xbad2": reverted })), (t) => failed.push(t)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RouteRevert);
    expect(err).toMatchObject({ code: "UPSTREAM_ERROR", message: "Could not simulate the transaction." });
    expect(failed).toEqual(providers.map((p) => p.target));
  });

  it("does not retry with a single provider that has no alternative", async () => {
    const only = provider("k", 105n, "0xbad1");
    const err = await withRouteFallback({ reader: {}, events: {}, swap: only } as unknown as QuoteDeps, quoteVia(node({ "0xbad1": reverted }))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RouteRevert);
    expect(only.quotes).toBe(1);
  });
});
