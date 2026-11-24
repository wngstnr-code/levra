import type { Metadata } from "next";
import { PreparedView } from "@/components/agent/PreparedView";

export const metadata: Metadata = { title: "Prepared action · Levra" };

export default async function PreparedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PreparedView id={id} />;
}
