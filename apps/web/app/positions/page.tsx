import type { Metadata } from "next";
import { Suspense } from "react";
import { PositionsView } from "@/components/positions/PositionsView";

export const metadata: Metadata = { title: "Positions · Levra" };

export default function PositionsPage() {
  return (
    <Suspense>
      <PositionsView />
    </Suspense>
  );
}
