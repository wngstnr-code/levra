import { stocks } from "@levra/shared/markets";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketDetailView } from "@/components/detail/MarketDetailView";

export function generateStaticParams() {
  return Object.keys(stocks).map((symbol) => ({ symbol }));
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  return { title: `a${symbol} · Levra` };
}

export default async function MarketDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (!Object.hasOwn(stocks, symbol)) notFound();
  return <MarketDetailView symbol={symbol} />;
}
