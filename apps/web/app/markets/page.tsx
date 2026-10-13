import type { Metadata } from "next";
import { OracleMarkets } from "@/components/OracleMarkets";

export const metadata: Metadata = { title: "Markets · Levra" };

export default function MarketsPage() {
  return (
    <div className="space-y-4">
      <div className="pt-2 pb-4">
        <h1 className="text-display text-[40px] font-semibold leading-tight">Markets</h1>
        <p className="mt-2 text-[15px] text-fg-2">
          Prices and market sessions read directly from the Anchored oracle on Monad. Source quotes can be about 15 minutes
          behind the stock exchange.
        </p>
      </div>
      <OracleMarkets />
    </div>
  );
}
