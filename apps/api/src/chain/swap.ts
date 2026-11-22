import { externalByChain } from "@levra/shared/addresses";
import { marginRouterAbi } from "@levra/shared/abis";
import type { ChainId } from "@levra/shared/chains";
import { bestRoute, createAero, createKyber, createOneInch, KYBER_BASE_URL, KYBER_MONAD_URL, SwapError, type SwapProvider, type SwapSource } from "@levra/swap";
import type { Address, PublicClient } from "viem";
import { budgetedProvider, defaultSwapBudget, KYBER_COST, ONEINCH_COST, oneInchBudget } from "../rate-limit/swap-budget";

export type SwapKeys = {
  kyberClientId: string;
  kyberApiKey?: string;
  /** KyberSwap endpoint for Monad; Base always uses KyberSwap's Base endpoint. */
  kyberMonadUrl?: string;
  /** Without it 1inch is left out. */
  oneInchApiKey?: string;
};

/**
 * Every swap provider the API knows on a chain (BE-96, D-80): KyberSwap on Monad (D-81); KyberSwap, 1inch and the Aero
 * SwapRouter on Base. X Layer gets the OKX DEX API with BE-81, so it has none yet. Each HTTP provider has its own budget.
 */
export function swapProviders(chainId: ChainId, client: PublicClient, keys: SwapKeys): SwapProvider[] {
  const kyber = (baseUrl: string) => budgetedProvider(createKyber({ baseUrl, clientId: keys.kyberClientId, apiKey: keys.kyberApiKey }), defaultSwapBudget, KYBER_COST);
  if (chainId === 143) return [kyber(keys.kyberMonadUrl ?? KYBER_MONAD_URL)];
  if (chainId === 8453) {
    const ext = externalByChain[8453];
    return [
      kyber(KYBER_BASE_URL),
      ...(keys.oneInchApiKey ? [budgetedProvider(createOneInch({ chainId, apiKey: keys.oneInchApiKey, router: ext.oneInchRouter }), oneInchBudget, ONEINCH_COST)] : []),
      createAero({ client, factory: ext.aeroClFactory, swapRouter: ext.aeroSwapRouter, metaQuoter: ext.aeroMetaQuoter }),
    ];
  }
  return [];
}

const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();

/**
 * The providers the router accepts: its target is in `swapTargets()` and the router approves the same spender
 * (`swapSpender`). A provider the router would refuse is never quoted.
 */
export async function allowedProviders(client: PublicClient, router: Address, providers: readonly SwapProvider[]): Promise<SwapProvider[]> {
  const targets = await client.readContract({ address: router, abi: marginRouterAbi, functionName: "swapTargets" });
  const spenders = await Promise.all(targets.map((t) => client.readContract({ address: router, abi: marginRouterAbi, functionName: "swapSpender", args: [t] })));
  return providers.filter((p) => targets.some((t, i) => same(t, p.target) && same(spenders[i]!, p.spender)));
}

/**
 * The best route among the allowed providers of one router. The router's list is read on first use and kept; a failed
 * read is tried again on the next quote. Null when the chain has no provider at all, so its quote routes stay off.
 */
export function routeForRouter(client: PublicClient, router: Address, providers: readonly SwapProvider[]): SwapSource | null {
  if (providers.length === 0) return null;
  let route: Promise<SwapSource> | null = null;
  const resolve = () => {
    route ??= allowedProviders(client, router, providers).then(
      (allowed) => {
        if (allowed.length === 0) throw new SwapError("NO_ROUTE", "The router accepts none of our swap providers.");
        return allowed.length === 1 ? allowed[0]! : bestRoute(allowed);
      },
      (err) => {
        route = null;
        throw new SwapError("UPSTREAM_ERROR", "Could not read the router's swap targets.", undefined, err);
      },
    );
    return route;
  };
  return {
    async quote(p) {
      return (await resolve()).quote(p);
    },
    async price(p) {
      return (await resolve()).price(p);
    },
  };
}
