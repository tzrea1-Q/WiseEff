import { defineConfig, devices } from "playwright/test";
import { buildPlaywrightWebServers } from "./playwright.shared";
import { loadAcceptanceEnvironment } from "./e2e/acceptance/helpers/acceptanceEnvironment";

const acceptanceEnvironment = loadAcceptanceEnvironment();
const ownedRuntime = acceptanceEnvironment.mode === "owned-descriptor"
  ? acceptanceEnvironment.ownedRuntime
  : undefined;
const baseURL = ownedRuntime?.endpoints.frontend.url ?? process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL ?? "http://127.0.0.1:5173";
const apiURL = ownedRuntime?.endpoints.api.url ?? process.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
const reuseExistingServer = !process.env.CI;
const skipWebServers = process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME === "true";
const outputDir = process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR ?? "test-results/acceptance";
const reportDir = process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR ?? "playwright-report/acceptance";

export default defineConfig({
  testDir: "./e2e/acceptance",
  outputDir,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: `${outputDir}/results.json` }],
    ["html", { outputFolder: reportDir, open: "never" }]
  ],
  timeout: 90_000,
  retries: ownedRuntime ? 0 : process.env.CI ? 1 : 0,
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
      name: "runtime-warmup",
      testMatch: /runtime-warmup\.spec\.ts/,
      timeout: 120_000,
      use: {
        ...devices["Desktop Chrome"]
      }
    },
    {
      name: "Desktop Chrome",
      testIgnore: /runtime-warmup\.spec\.ts/,
      dependencies: ["runtime-warmup"],
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ],
  webServer: ownedRuntime || skipWebServers
    ? []
    : buildPlaywrightWebServers({
        baseURL,
        apiURL,
        reuseExistingServer,
        authMode: "production",
        includeXiaozeProactive: true,
        projectConfigurationWorkbenchEnabled: true
      })
});
