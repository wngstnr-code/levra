import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketDetailView } from "@/components/detail/MarketDetailView";
import { stockOn, webChainBySlug, webChains } from "@/lib/chains";

export function generateStaticParams() {
  return webChains.flatMap((c) => Object.keys(c.stocks).map((symbol) => ({ chain: c.slug, symbol })));
}

export async function generateMetadata({ params }: { params: Promise<{ chain: string; symbol: string }> }): Promise<Metadata> {
  const { chain, symbol } = await params;
  const c = webChainBySlug(chain);
  const stock = c ? stockOn(c, symbol) : null;
  return { title: `${stock?.tokenSymbol ?? symbol} · Levra` };
}

export default async function MarketDetailPage({ params }: { params: Promise<{ chain: string; symbol: string }> }) {
  const { chain, symbol } = await params;
  const c = webChainBySlug(chain);
  if (!c || !stockOn(c, symbol)) notFound();
  return <MarketDetailView symbol={symbol} />;
}
