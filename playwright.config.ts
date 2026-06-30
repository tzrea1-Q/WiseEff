import { defineConfig, devices } from "playwright/test";
import { buildPlaywrightWebServers } from "./playwright.shared";

const baseURL = "http://127.0.0.1:5173";
const apiURL = process.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["quality/*.quality.spec.ts", "acceptance/**"],
  snapshotPathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{platform}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 90_000,
  expect: {
    timeout: 10_000
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure"
  },
  webServer: buildPlaywrightWebServers({
    baseURL,
    apiURL,
    reuseExistingServer,
    frontendCommand: "npm run dev"
  })
});
