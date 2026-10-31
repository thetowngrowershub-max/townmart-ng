import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: purchase, refund and booking, in a real browser against a
 * running app and worker with the fake payment provider (README, "Scripts").
 *
 *   pnpm build && NODE_ENV=development pnpm start   # or pnpm dev; fake drivers need a non-production NODE_ENV
 *   pnpm worker
 *   pnpm test:e2e
 */
const baseURL = process.env.E2E_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // The flows share one database and the same sellers' stock: run them in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "en-NG",
    timezoneId: "Africa/Lagos",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
});
