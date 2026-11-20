import type { Metadata } from "next";
import { Suspense } from "react";
import { OpenGate } from "@/components/gate/Compliance";
import { TradeView } from "@/components/trade/TradeView";

export const metadata: Metadata = { title: "Trade · Levra" };

export default function TradePage() {
  return (
    <Suspense>
      <OpenGate>
        <TradeView />
      </OpenGate>
    </Suspense>
  );
}
