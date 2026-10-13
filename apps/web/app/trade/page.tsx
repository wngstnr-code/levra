import type { Metadata } from "next";
import { Suspense } from "react";
import { TradeView } from "@/components/trade/TradeView";

export const metadata: Metadata = { title: "Trade · Levra" };

export default function TradePage() {
  return (
    <Suspense>
      <TradeView />
    </Suspense>
  );
}
