import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Header } from "@/components/Header";
import { StatusBanners } from "@/components/StatusBanners";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Levra",
  description: "A margin account for tokenized stocks on Monad.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen">
        <Providers>
          <Header />
          <main className="mx-auto max-w-[1440px] space-y-4 px-4 pt-2 pb-16 sm:px-12">
            <StatusBanners />
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
