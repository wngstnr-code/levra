import type { NextConfig } from "next";

const config: NextConfig = {
  // End-to-end tests build into their own folder, so they never overwrite the normal build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@levra/shared", "@levra/cctp"],
  // Links shared before chains were in the URL (D-60) keep working on Monad.
  async redirects() {
    return ["markets", "trade", "positions", "earn", "deposit", "settings", "help"].flatMap((page) => [
      { source: `/${page}`, destination: `/monad/${page}`, permanent: false },
      { source: `/${page}/:rest*`, destination: `/monad/${page}/:rest*`, permanent: false },
    ]);
  },
};

export default config;
