import { externalByChain } from "@levra/shared/addresses";
import { SwapError, type SwapProvider } from "@levra/swap";
import type { Address, PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { allowedProviders, routeForRouter, swapProviders } from "../src/chain/swap";

const ROUTER = "0x00000000000000000000000000000000000000aa" as Address;
const A = "0x000000000000000000000000000000000000000a" as Address;
const B = "0x000000000000000000000000000000000000000b" as Address;
const C = "0x000000000000000000000000000000000000000c" as Address;
const TOKEN_IN = "0x0000000000000000000000000000000000000001" as Address;
const TOKEN_OUT = "0x0000000000000000000000000000000000000002" as Address;

/** A router read: `swapTargets()` and `swapSpender(target)`, counting the calls; `fail` makes the next read throw. */
function routerClient(spenders: Record<Address, Address>) {
  const state = { reads: 0, fail: false };
  const client = {
    async readContract({ functionName, args }: { functionName: string; args?: readonly unknown[] }) {
      state.reads++;
      if (state.fail) throw new Error("rpc down");
      if (functionName === "swapTargets") return Object.keys(spenders);
      if (functionName === "swapSpender") return spenders[args![0] as Address];
      throw new Error(`unexpected ${functionName}`);
    },
  } as unknown as PublicClient;
  return { client, state };
}

function provider(name: string, target: Address, out: bigint, spender: Address = target): SwapProvider & { calls: number } {
  const p = {
    name,
    target,
    spender,
    calls: 0,
    async price() {
      p.calls++;
      return out;
    },
    async quote({ amountIn }: { amountIn: bigint }) {
      p.calls++;
      return { amountIn, amountOut: out, data: "0x" as const, target };
    },
  };
  return p;
}

const quoteParams = { tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: 100n, sender: ROUTER, slippageBps: 50 };
const keys = { kyberClientId: "levra" };
const noClient = {} as PublicClient;

describe("swap providers per chain (BE-96)", () => {
  it("knows KyberSwap on Monad, KyberSwap and Aero on Base plus 1inch with a key, and nothing on X Layer yet", () => {
    const names = (chainId: 143 | 8453 | 196, k = keys) => swapProviders(chainId, noClient, k).map((p) => p.name);
    expect(names(143)).toEqual(["kyberswap"]);
    expect(names(8453)).toEqual(["kyberswap", "aero"]);
    expect(names(8453, { ...keys, oneInchApiKey: "key" } as typeof keys)).toEqual(["kyberswap", "1inch", "aero"]);
    expect(names(196)).toEqual([]);
  });

  it("uses the Base router addresses the deployment allows (05)", () => {
    const base = externalByChain[8453];
    const byName = Object.fromEntries(swapProviders(8453, noClient, { ...keys, oneInchApiKey: "key" } as typeof keys).map((p) => [p.name, [p.target, p.spender]]));
    expect(byName).toEqual({
      kyberswap: [base.kyberRouter, base.kyberRouter],
      "1inch": [base.oneInchRouter, base.oneInchRouter],
      aero: [base.aeroSwapRouter, base.aeroSwapRouter],
    });
  });

  it("keeps only providers whose target the router lists with the same spender", async () => {
    const { client } = routerClient({ [A]: A, [B]: C });
    const allowed = await allowedProviders(client, ROUTER, [provider("a", A, 1n), provider("b", B, 1n), provider("c", C, 1n)]);
    // b's target is listed but the router approves another spender; c is not listed.
    expect(allowed.map((p) => p.name)).toEqual(["a"]);
    const again = await allowedProviders(client, ROUTER, [provider("a", A, 1n), provider("b", B, 1n, C)]);
    expect(again.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("takes the target as spender on a router without swapSpender (before D-79)", async () => {
    const client = {
      async readContract({ functionName }: { functionName: string }) {
        if (functionName === "swapTargets") return [A];
        throw new Error("execution reverted");
      },
    } as unknown as PublicClient;
    expect((await allowedProviders(client, ROUTER, [provider("a", A, 1n), provider("b", A, 1n, B)])).map((p) => p.name)).toEqual(["a"]);
  });

  it("matches addresses in any letter case", async () => {
    const { client } = routerClient({ [A.toUpperCase().replace("0X", "0x") as Address]: A });
    expect((await allowedProviders(client, ROUTER, [provider("a", A, 1n)])).map((p) => p.name)).toEqual(["a"]);
  });
});

describe("the route of one router", () => {
  it("is null for a chain without providers", () => {
    expect(routeForRouter(noClient, ROUTER, [])).toBeNull();
  });

  it("quotes the best allowed provider and never asks one the router refuses", async () => {
    const { client } = routerClient({ [A]: A, [B]: B });
    const refused = provider("c", C, 1_000n);
    const route = routeForRouter(client, ROUTER, [provider("a", A, 90n), provider("b", B, 95n), refused])!;
    expect((await route.quote(quoteParams)).target).toBe(B);
    expect(await route.price(quoteParams)).toBe(95n);
    expect(refused.calls).toBe(0);
  });

  it("reads the router's list once, and again after a failed read", async () => {
    const { client, state } = routerClient({ [A]: A });
    const route = routeForRouter(client, ROUTER, [provider("a", A, 1n)])!;
    state.fail = true;
    await expect(route.quote(quoteParams)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    state.fail = false;
    const before = state.reads;
    await route.quote(quoteParams);
    await route.price(quoteParams);
    expect(state.reads - before).toBe(2);
  });

  it("answers NO_ROUTE when the router accepts none of our providers", async () => {
    const { client } = routerClient({ [A]: A });
    const route = routeForRouter(client, ROUTER, [provider("b", B, 1n)])!;
    const err = await route.quote(quoteParams).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SwapError);
    expect((err as SwapError).code).toBe("NO_ROUTE");
  });
});
