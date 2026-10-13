import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/** The app is built with a fake service address; every test answers that address itself. */
export const API = "http://api.levra.test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/markets`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_API_URL: API, NEXT_PUBLIC_PRIVY_APP_ID: "", NEXT_DIST_DIR: ".next-e2e" },
  },
});
