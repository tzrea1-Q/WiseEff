import { defineConfig, devices } from "playwright/test";
import { loadAcceptanceEnvironment } from "./e2e/acceptance/helpers/acceptanceEnvironment";
import { buildPlaywrightWebServers, portFromUrl } from "./playwright.shared";
import { requireCaptureDatabase } from "./scripts/run-user-guide-screenshots";

requireCaptureDatabase();
const environment = loadAcceptanceEnvironment();
const ownedRuntime = environment.mode === "owned-descriptor" ? environment.ownedRuntime : undefined;
if (process.env.AUTH_MODE !== "production" || process.env.AUTH_PROVIDER !== "local") {
  throw new Error("User Guide capture requires production-mode local authentication; run npm run docs:screenshots.");
}
if (!ownedRuntime && process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME === "true") {
  throw new Error("An external capture runtime requires an owned descriptor proving its database identity.");
}
const baseURL = ownedRuntime?.endpoints.frontend.url ?? process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL ?? "http://127.0.0.1:5187";
const apiURL = ownedRuntime?.endpoints.api.url ?? process.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8797";
process.env.VITE_WISEEFF_API_BASE_URL = apiURL;

export default defineConfig({
  testDir: "./e2e/user-guide",
  testMatch: "capture.ts",
  outputDir: "test-results/user-guide",
  reporter: [["list"]],
  retries: 0,
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    contextOptions: { reducedMotion: "reduce" },
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off"
  },
  expect: { timeout: 20_000 },
  projects: [{ name: "user-guide", testMatch: "capture.ts" }],
  webServer: ownedRuntime ? [] : buildPlaywrightWebServers({
    baseURL,
    apiURL,
    reuseExistingServer: false,
    authMode: "production",
    frontendCommand: `npm run dev -- --port ${portFromUrl(baseURL, "5187")} --strictPort`
  })
});
