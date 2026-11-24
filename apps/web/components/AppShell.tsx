"use client";

import { usePathname } from "next/navigation";
import { Footer } from "./Footer";
import { BottomNav, Header } from "./Header";
import { StatusBanners } from "./StatusBanners";

/** The app's header, banners and footer around every page except the landing, which draws its own. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  if (pathname === "/landing" || pathname.startsWith("/landing/")) return <>{children}</>;
  return (
    <>
      <Header />
      <main id="content" tabIndex={-1} className="mx-auto max-w-[1440px] space-y-4 px-4 pt-2 pb-8 outline-none sm:px-12">
        <StatusBanners />
        {children}
      </main>
      <Footer />
      <BottomNav />
    </>
  );
}
