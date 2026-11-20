import { notFound } from "next/navigation";
import { webChainBySlug, webChains } from "@/lib/chains";

export function generateStaticParams() {
  return webChains.map((c) => ({ chain: c.slug }));
}

export default async function ChainLayout({ children, params }: { children: React.ReactNode; params: Promise<{ chain: string }> }) {
  const { chain } = await params;
  if (!webChainBySlug(chain)) notFound();
  return children;
}
