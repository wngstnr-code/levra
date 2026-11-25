import { marginRouterAbi } from "@levra/shared/abis";
import type { Address, PublicClient } from "viem";
import { bestRoute } from "./best";
import { SwapError, type SwapProvider, type SwapSource } from "./types";

const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();

/**
 * The providers a contract accepts: its target is in `swapTargets()` and the contract approves the same spender
 * (`swapSpender`). The router and the `Liquidator` share these two functions (D-79). A provider the contract would refuse
 * is never quoted.
 */
export async function allowedProviders(client: PublicClient, contract: Address, providers: readonly SwapProvider[]): Promise<SwapProvider[]> {
  const targets = await client.readContract({ address: contract, abi: marginRouterAbi, functionName: "swapTargets" });
  // A contract from before fixed spenders (D-79) has no `swapSpender` and approves the target itself.
  const spenders = await Promise.all(
    targets.map((t) => client.readContract({ address: contract, abi: marginRouterAbi, functionName: "swapSpender", args: [t] }).catch(() => t)),
  );
  return providers.filter((p) => targets.some((t, i) => same(t, p.target) && same(spenders[i]!, p.spender)));
}

/**
 * The best route among the allowed providers of one contract. Its list is read on first use and kept; a failed read is
 * tried again on the next quote. Null when the chain has no provider at all, so its quote routes stay off.
 */
export function routeForRouter(client: PublicClient, contract: Address, providers: readonly SwapProvider[]): SwapSource | null {
  if (providers.length === 0) return null;
  let route: Promise<SwapSource> | null = null;
  const resolve = () => {
    route ??= allowedProviders(client, contract, providers).then(
      (allowed) => {
        if (allowed.length === 0) throw new SwapError("NO_ROUTE", "The contract accepts none of our swap providers.");
        return allowed.length === 1 ? allowed[0]! : bestRoute(allowed);
      },
      (err) => {
        route = null;
        throw new SwapError("UPSTREAM_ERROR", "Could not read the contract's swap targets.", undefined, err);
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
