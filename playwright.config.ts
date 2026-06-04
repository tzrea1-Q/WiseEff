import { defineConfig, devices } from "playwright/test";

const baseURL = "http://127.0.0.1:5173";
const apiURL = process.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["quality/*.quality.spec.ts"],
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
  webServer: [
    {
      command: "npm run dev:api",
      env: {
        PORT: "8787",
        AGENT_PROVIDER: "deterministic",
        VITE_WISEEFF_RUNTIME_MODE: "api",
        VITE_WISEEFF_API_BASE_URL: apiURL,
        DEBUG_DEVICE_GATEWAY_MODE: process.env.DEBUG_DEVICE_GATEWAY_MODE ?? "simulator",
        OBJECT_STORE_ROOT: process.env.OBJECT_STORE_ROOT ?? ".wiseeff-object-store",
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {})
      },
      url: `${apiURL}/api/v1/health`,
      reuseExistingServer,
      timeout: 60_000
    },
    {
      command: "npm run dev",
      env: {
        VITE_WISEEFF_RUNTIME_MODE: "api",
        VITE_WISEEFF_API_BASE_URL: apiURL
      },
      url: baseURL,
      reuseExistingServer,
      timeout: 60_000
    }
  ]
});
