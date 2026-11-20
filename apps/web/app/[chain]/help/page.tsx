import type { Metadata } from "next";
import { HelpView } from "@/components/help/HelpView";

export const metadata: Metadata = { title: "Help · Levra" };

export default function HelpPage() {
  return <HelpView />;
}
