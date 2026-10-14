import { defineConfig, devices } from "playwright/test";
import { buildPlaywrightWebServers, portFromUrl } from "./playwright.shared";
import { loadAcceptanceEnvironment } from "./e2e/acceptance/helpers/acceptanceEnvironment";
import { consistencyTestMatch, parseQualityLane, selectQualityProjects } from "./e2e/quality/quality-partition";
import { applyPlaywrightRuntimeLane } from "./scripts/playwright-runtime-lane";

const acceptanceEnvironment = loadAcceptanceEnvironment();
const runtimeLane = applyPlaywrightRuntimeLane();
const qualityLane = parseQualityLane(process.env.WISEEFF_QUALITY_LANE);
const ownedRuntime = acceptanceEnvironment.mode === "owned-descriptor"
  ? acceptanceEnvironment.ownedRuntime
  : undefined;
const baseURL = runtimeLane?.baseURL ?? ownedRuntime?.endpoints.frontend.url ?? process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL ?? "http://127.0.0.1:5173";
const apiURL = runtimeLane?.apiURL ?? ownedRuntime?.endpoints.api.url ?? process.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
const frontendPort = portFromUrl(baseURL, "5173");
const reuseExistingServer = !runtimeLane && !process.env.CI;
const skipWebServers = process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME === "true";
const outputDir = runtimeLane ? `${runtimeLane.outputDir}/quality` : process.env.WISEEFF_QUALITY_PLAYWRIGHT_OUTPUT_DIR ?? "test-results/quality";
const reportDir = runtimeLane ? `${runtimeLane.reportDir}/quality` : process.env.WISEEFF_QUALITY_PLAYWRIGHT_REPORT_DIR ?? "playwright-report/quality";
const snapshotRoot = process.env.WISEEFF_QUALITY_SNAPSHOT_ROOT?.trim();

export default defineConfig({
  testDir: "./e2e/quality",
  outputDir,
  snapshotPathTemplate: snapshotRoot
    ? `${snapshotRoot}/{platform}/{arg}{ext}`
    : "{testDir}/{testFileName}-snapshots/{platform}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["./e2e/quality/phase-reporter.ts"],
    ["list"],
    ["json", { outputFile: `${outputDir}/results.json` }],
    ["html", { outputFolder: reportDir, open: "never" }]
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
  projects: selectQualityProjects([
    {
      name: "runtime-warmup",
      testMatch: /warmup\.quality\.spec\.ts/,
      timeout: 120_000,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "a11y",
      testMatch: /a11y\.quality\.spec\.ts/,
      dependencies: ["runtime-warmup"],
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "visual",
      testMatch: /visual\.quality\.spec\.ts/,
      dependencies: ["runtime-warmup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
    },
    {
      name: "consistency",
      testMatch: consistencyTestMatch(qualityLane),
      dependencies: ["runtime-warmup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        serviceWorkers: "block",
        reducedMotion: "reduce"
      }
    },
    {
      name: "compact",
      testMatch: /compact\.quality\.spec\.ts/,
      dependencies: ["runtime-warmup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        serviceWorkers: "block",
        reducedMotion: "reduce"
      }
    },
    {
      name: "responsive",
      testMatch: /responsive\.quality\.spec\.ts/,
      dependencies: ["runtime-warmup"],
      use: { ...devices["Desktop Chrome"] }
    }
  ], qualityLane),
  webServer: ownedRuntime || skipWebServers
    ? []
    : buildPlaywrightWebServers({
        baseURL,
        apiURL,
        reuseExistingServer,
        frontendCommand: `npm run dev -- --port ${frontendPort} --strictPort`
      })
});
