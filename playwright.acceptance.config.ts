import { defineConfig, devices } from "playwright/test";
import dotenv from "dotenv";
import { buildPlaywrightWebServers } from "./playwright.shared";

dotenv.config({ path: process.env.WISEEFF_ACCEPTANCE_ENV_FILE ?? ".env" });

const baseURL = process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL ?? "http://127.0.0.1:5173";
const apiURL = process.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
const reuseExistingServer = !process.env.CI;
const skipWebServers = process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME === "true";

export default defineConfig({
  testDir: "./e2e/acceptance",
  outputDir: "test-results/acceptance",
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/acceptance/results.json" }],
    ["html", { outputFolder: "playwright-report/acceptance", open: "never" }]
  ],
  timeout: 90_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "Desktop Chrome",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ],
  webServer: skipWebServers
    ? []
    : buildPlaywrightWebServers({
        baseURL,
        apiURL,
        reuseExistingServer,
        includeXiaozeProactive: true
      })
});
