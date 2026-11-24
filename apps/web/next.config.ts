import type { NextConfig } from "next";

const config: NextConfig = {
  // End-to-end tests build into their own folder, so they never overwrite the normal build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@levra/shared", "@levra/cctp"],
  // Local development only: the API allows the app's own origin (CORS), so localhost reaches it through this proxy.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET;
    if (!target || process.env.NODE_ENV === "production") return [];
    return [{ source: "/api-proxy/:path*", destination: `${target.replace(/\/$/, "")}/:path*` }];
  },
  // Links shared before chains were in the URL (D-60) keep working on Monad.
  async redirects() {
    return ["markets", "trade", "positions", "earn", "deposit", "settings", "help"].flatMap((page) => [
      { source: `/${page}`, destination: `/monad/${page}`, permanent: false },
      { source: `/${page}/:rest*`, destination: `/monad/${page}/:rest*`, permanent: false },
    ]);
  },
};

export default config;
