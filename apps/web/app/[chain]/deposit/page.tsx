import type { Metadata } from "next";
import { Suspense } from "react";
import { DepositView } from "@/components/deposit/DepositView";

export const metadata: Metadata = { title: "Deposit · Levra" };

export default function DepositPage() {
  return (
    <Suspense>
      <DepositView />
    </Suspense>
  );
}
