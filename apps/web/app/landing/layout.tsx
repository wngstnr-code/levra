import type { Metadata } from "next";
import { DM_Mono, DM_Sans, League_Gothic } from "next/font/google";
import "./landing.css";

const league = League_Gothic({ subsets: ["latin"], variable: "--font-league", display: "swap" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dm-mono", display: "swap" });

export const metadata: Metadata = { title: "Levra · Leverage on tokenized stocks" };

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${league.variable} ${dmSans.variable} ${dmMono.variable} min-h-screen bg-black font-[family-name:var(--font-dm-sans)] text-white cursor-[url(/cursor/default.svg)_28_28,auto]`}>
      {children}
    </div>
  );
}
