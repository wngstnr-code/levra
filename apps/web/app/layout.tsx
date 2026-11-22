import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Inter } from "next/font/google";
import { Footer } from "@/components/Footer";
import { BottomNav, Header } from "@/components/Header";
import { StatusBanners } from "@/components/StatusBanners";
import "./globals.css";
import { Providers } from "./providers";
import { themeBootScript } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Levra",
  description: "A margin account for tokenized stocks on Monad.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen">
        <Providers>
          <Header />
          <main id="content" tabIndex={-1} className="mx-auto max-w-[1440px] space-y-4 px-4 pt-2 pb-8 outline-none sm:px-12">
            <StatusBanners />
            {children}
          </main>
          <Footer />
          <BottomNav />
        </Providers>
        {process.env.VERCEL && <Analytics />}
      </body>
    </html>
  );
}
