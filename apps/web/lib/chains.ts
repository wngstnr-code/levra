import { externalByChain, tokensByChain, type Address } from "@levra/shared/addresses";
import { chains as sharedChains, chainBySlug, DEFAULT_CHAIN_ID, type ChainId, type ChainSlug } from "@levra/shared/chains";
import type { Deployment } from "@levra/shared/deployments";
import { baseDeployment } from "@levra/shared/deployments/base";
import { monadDeployment } from "@levra/shared/deployments/monad";
import { xlayerDeployment } from "@levra/shared/deployments/xlayer";
import { stocksByChain, type AnyStock } from "@levra/shared/markets";
import { http, type Chain as ViemChain, type Transport } from "viem";
import { base as baseDefaults, monad as monadDefaults, xLayer as xLayerDefaults } from "viem/chains";

/** Deployments of our contracts per chain. A chain is offered in the app only when it is listed here. */
const deployments: Partial<Record<ChainId, Deployment>> = { 143: monadDeployment, 8453: baseDeployment, 196: xlayerDeployment };

const rpcUrls: Record<ChainId, string | undefined> = {
  143: process.env.NEXT_PUBLIC_MONAD_RPC_URL || undefined,
  8453: process.env.NEXT_PUBLIC_BASE_RPC_URL || undefined,
  196: process.env.NEXT_PUBLIC_XLAYER_RPC_URL || undefined,
};

const viemDefaults: Record<ChainId, ViemChain> = { 143: monadDefaults, 8453: baseDefaults, 196: xLayerDefaults };

/** How the hard limit price is read: the Anchored stock oracle on Monad, Chainlink style feeds elsewhere (D-49, D-56). */
export type PriceSource = "anchored" | "chainlink";

export type WebChain = {
  id: ChainId;
  slug: ChainSlug;
  name: string;
  nativeSymbol: string;
  explorer: string;
  viem: ViemChain;
  transport: Transport;
  deployment: Deployment;
  morpho: Address;
  usdc: { address: Address; decimals: number };
  priceSource: PriceSource;
  stocks: Record<string, AnyStock>;
};

function build(id: ChainId, deployment: Deployment): WebChain {
  const shared = sharedChains[id];
  const rpc = rpcUrls[id];
  const defaults = viemDefaults[id];
  if (defaults.id !== id) throw new Error(`viem chain id ${defaults.id} is not ${id}`);
  const viem = rpc ? { ...defaults, rpcUrls: { default: { http: [rpc] } } } : defaults;
  return {
    id,
    slug: shared.slug,
    name: shared.name,
    nativeSymbol: shared.nativeSymbol,
    explorer: shared.explorer,
    viem,
    transport: http(rpc),
    deployment,
    morpho: externalByChain[id].morpho,
    usdc: tokensByChain[id].USDC,
    priceSource: id === 143 ? "anchored" : "chainlink",
    stocks: stocksByChain[id] as Record<string, AnyStock>,
  };
}

/** Chains with our contracts deployed, in the order of shared/chains.ts. */
export const webChains: WebChain[] = (Object.keys(deployments).map(Number) as ChainId[])
  .sort((a, b) => Object.keys(sharedChains).indexOf(String(a)) - Object.keys(sharedChains).indexOf(String(b)))
  .map((id) => build(id, deployments[id]!));

const fallback = webChains.find((c) => c.id === DEFAULT_CHAIN_ID) ?? webChains[0]!;
export const defaultChain: WebChain = fallback;

export function webChainBySlug(slug: string): WebChain | undefined {
  const shared = chainBySlug(slug);
  return shared ? webChains.find((c) => c.id === shared.id) : undefined;
}

export function webChainById(id: number): WebChain | undefined {
  return webChains.find((c) => c.id === id);
}

export function stockOn(chain: WebChain, symbol: string): AnyStock | null {
  return Object.hasOwn(chain.stocks, symbol) ? chain.stocks[symbol]! : null;
}

/** Stocks with at least one deployed market on the chain, in deployment order. */
export function listedStocks(chain: WebChain): AnyStock[] {
  return [...new Set(chain.deployment.markets.map((m) => m.symbol))].map((s) => stockOn(chain, s)).filter((s): s is AnyStock => s !== null);
}

export function deployedMarketOn(chain: WebChain, symbol: string, side: "long" | "short") {
  return chain.deployment.markets.find((m) => m.symbol === symbol && m.side === side) ?? null;
}

/** Puts the chain into an app path: /markets becomes /base/markets. */
export function chainPath(chain: Pick<WebChain, "slug">, path: string): string {
  return `/${chain.slug}${path.startsWith("/") ? path : `/${path}`}`;
}
