import { defineConfig, devices } from "playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: process.env.WISEEFF_ACCEPTANCE_ENV_FILE ?? ".env" });

const baseURL = process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL ?? "http://127.0.0.1:5173";
const apiURL = process.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
const apiAuthorization =
  process.env.VITE_WISEEFF_API_AUTHORIZATION ??
  process.env.M5_SMOKE_AUTHORIZATION ??
  process.env.WISEEFF_SMOKE_AUTHORIZATION;
const apiAuthProvider =
  apiAuthorization && process.env.AUTH_PROVIDER !== "oidc" ? "hmac" : process.env.AUTH_PROVIDER ?? "local";
const frontendPort = portFromUrl(baseURL, "5173");
const apiPort = portFromUrl(apiURL, "8787");
const reuseExistingServer = !process.env.CI;
const skipWebServers = process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME === "true";
const webServers = [
  {
    command: "npm run dev:api",
    env: {
      PORT: apiPort,
      AGENT_PROVIDER: "deterministic",
      AUTH_MODE: process.env.AUTH_MODE ?? "production",
      AUTH_PROVIDER: apiAuthProvider,
      ...(process.env.AUTH_TOKEN_ISSUER ? { AUTH_TOKEN_ISSUER: process.env.AUTH_TOKEN_ISSUER } : {}),
      ...(process.env.AUTH_TOKEN_HMAC_SECRET ? { AUTH_TOKEN_HMAC_SECRET: process.env.AUTH_TOKEN_HMAC_SECRET } : {}),
      ...(process.env.AUTH_OIDC_ISSUER ? { AUTH_OIDC_ISSUER: process.env.AUTH_OIDC_ISSUER } : {}),
      ...(process.env.AUTH_OIDC_AUDIENCE ? { AUTH_OIDC_AUDIENCE: process.env.AUTH_OIDC_AUDIENCE } : {}),
      ...(process.env.AUTH_OIDC_JWKS_URI ? { AUTH_OIDC_JWKS_URI: process.env.AUTH_OIDC_JWKS_URI } : {}),
      VITE_WISEEFF_RUNTIME_MODE: "api",
      VITE_WISEEFF_API_BASE_URL: apiURL,
      DEBUG_DEVICE_GATEWAY_MODE: process.env.DEBUG_DEVICE_GATEWAY_MODE ?? "simulator",
      OBJECT_STORE_ROOT: process.env.OBJECT_STORE_ROOT ?? ".wiseeff-object-store",
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      XIAOZE_RUNTIME_ENABLED: "true",
      XIAOZE_DETERMINISTIC: "true"
    },
    url: `${apiURL}/api/v1/health`,
    reuseExistingServer,
    timeout: 60_000
  },
  {
    command: `npx vite --host 127.0.0.1 --port ${frontendPort} --strictPort`,
    env: {
      VITE_WISEEFF_RUNTIME_MODE: "api",
      VITE_WISEEFF_API_BASE_URL: apiURL,
      VITE_XIAOZE_ENABLED: "true",
      ...(apiAuthorization ? { VITE_WISEEFF_API_AUTHORIZATION: apiAuthorization } : {})
    },
    url: baseURL,
    reuseExistingServer,
    timeout: 60_000
  }
];

function portFromUrl(value: string, fallback: string) {
  try {
    return new URL(value).port || fallback;
  } catch {
    return fallback;
  }
}

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
  webServer: skipWebServers ? [] : webServers
});
