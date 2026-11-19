export const chains = {
  143: { id: 143, slug: "monad", name: "Monad", nativeSymbol: "MON", explorer: "https://monadvision.com" },
  8453: { id: 8453, slug: "base", name: "Base", nativeSymbol: "ETH", explorer: "https://basescan.org" },
  196: { id: 196, slug: "xlayer", name: "X Layer", nativeSymbol: "OKB", explorer: "https://www.oklink.com/x-layer" },
} as const;

export type ChainId = keyof typeof chains;
export type Chain = (typeof chains)[ChainId];
export type ChainSlug = Chain["slug"];

export const DEFAULT_CHAIN_ID = 143 satisfies ChainId;

export const chainIds = Object.values(chains).map((c) => c.id) as ChainId[];

export function isChainId(value: number): value is ChainId {
  return Object.hasOwn(chains, value);
}

export function chainBySlug(slug: string): Chain | undefined {
  return Object.values(chains).find((c) => c.slug === slug);
}
