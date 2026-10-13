import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database tests share one test database and run migrations, so files run one at a time.
    fileParallelism: false,
  },
});
