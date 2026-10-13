import type { NextConfig } from "next";

const config: NextConfig = {
  // End-to-end tests build into their own folder, so they never overwrite the normal build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@levra/shared"],
};

export default config;
