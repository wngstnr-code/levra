import type { Chain } from "viem";
import { arbitrum, avalanche, base, hyperEvm, ink, linea, mainnet, monad, optimism, polygon, sei, sonic, unichain, worldchain, xLayer } from "viem/chains";

/**
 * Chains a wallet may send USDC from or to through Circle CCTP (BE-85). The API lists the CCTP chains; the app offers
 * only the ones it can switch the wallet to, which are these.
 */
const known: Chain[] = [mainnet, avalanche, optimism, arbitrum, base, polygon, unichain, linea, sonic, worldchain, sei, hyperEvm, ink, xLayer, monad];

export function bridgeViemChain(chainId: number): Chain | undefined {
  return known.find((c) => c.id === chainId);
}

/** The CCTP chains beyond the ones in `ours`, for the wallet config. */
export function extraBridgeChains(ours: readonly Chain[]): Chain[] {
  return known.filter((c) => !ours.some((o) => o.id === c.id));
}
