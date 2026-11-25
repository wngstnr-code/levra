import { externalByChain } from "@levra/shared/addresses";
import type { ChainId } from "@levra/shared/chains";
import { createAero, createKyber, createOkx, createOneInch, createUniswapV3, KYBER_BASE_URL, KYBER_MONAD_URL, type SwapProvider } from "@levra/swap";
import type { PublicClient } from "viem";
import { budgetedProvider, defaultSwapBudget, KYBER_COST, OKX_COST, okxBudget, ONEINCH_COST, oneInchBudget } from "../rate-limit/swap-budget";

export type SwapKeys = {
  kyberClientId: string;
  kyberApiKey?: string;
  /** KyberSwap endpoint for Monad; Base always uses KyberSwap's Base endpoint. */
  kyberMonadUrl?: string;
  /** Without it 1inch is left out. */
  oneInchApiKey?: string;
  /** Without it X Layer quotes through Uniswap only, which has no pool for every stock (05). */
  okx?: { apiKey: string; secretKey: string; passphrase: string };
};

/**
 * Every swap provider the API knows on a chain (BE-96, BE-81, D-80, D-85): KyberSwap on Monad (D-81); KyberSwap, 1inch
 * and the Aero SwapRouter on Base; the OKX DEX API and the Uniswap SwapRouter02 fallback on X Layer. Each HTTP provider
 * has its own budget.
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
  const ext = externalByChain[196];
  return [
    ...(keys.okx ? [budgetedProvider(createOkx({ chainId, ...keys.okx, router: ext.okxDexRouter, approve: ext.okxDexApprove }), okxBudget, OKX_COST)] : []),
    createUniswapV3({ client, swapRouter02: ext.uniswapSwapRouter02, quoterV2: ext.uniswapQuoterV2 }),
  ];
}

/** Moved to `@levra/swap` so the keeper picks routes the same way (BE-73, BE-80). */
export { allowedProviders, routeForRouter } from "@levra/swap";
