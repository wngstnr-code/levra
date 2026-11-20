import type { Metadata } from "next";
import { EarnView } from "@/components/earn/EarnView";

export const metadata: Metadata = { title: "Earn · Levra" };

export default function EarnPage() {
  return <EarnView />;
}
