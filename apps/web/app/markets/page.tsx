import type { Metadata } from "next";
import { MarketsView } from "@/components/markets/MarketsView";

export const metadata: Metadata = { title: "Markets · Levra" };

export default function MarketsPage() {
  return <MarketsView />;
}
