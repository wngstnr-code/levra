import type { Metadata } from "next";
import { OracleMarkets } from "@/components/OracleMarkets";

export const metadata: Metadata = { title: "Markets · Levra" };

export default function MarketsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Markets</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Prices and market sessions read directly from the Anchored oracle on Monad. Source quotes can be about 15 minutes
          behind the stock exchange.
        </p>
      </div>
      <OracleMarkets />
    </div>
  );
}
