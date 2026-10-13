import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Fork tests share one local chain and take snapshots of it, so files run one at a time.
    fileParallelism: false,
  },
});
