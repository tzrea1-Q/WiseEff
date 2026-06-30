import { defineConfig, devices } from "playwright/test";
import dotenv from "dotenv";
import { buildPlaywrightWebServers, portFromUrl } from "./playwright.shared";

dotenv.config({ path: process.env.WISEEFF_ACCEPTANCE_ENV_FILE ?? ".env" });

const baseURL = process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL ?? "http://127.0.0.1:5173";
const apiURL = process.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
const frontendPort = portFromUrl(baseURL, "5173");
const reuseExistingServer = !process.env.CI;
const skipWebServers = process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME === "true";

export default defineConfig({
  testDir: "./e2e/quality",
  outputDir: "test-results/quality",
  snapshotPathTemplate: "{testDir}/{testFileName}-snapshots/{platform}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/quality", open: "never" }]
  ],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: "disabled"
    }
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [
    {
      name: "a11y",
      testMatch: /a11y\.quality\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "visual",
      testMatch: /visual\.quality\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
    },
    {
      name: "responsive",
      testMatch: /responsive\.quality\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: skipWebServers
    ? []
    : buildPlaywrightWebServers({
        baseURL,
        apiURL,
        reuseExistingServer,
        frontendCommand: `npm run dev -- --port ${frontendPort} --strictPort`
      })
});
