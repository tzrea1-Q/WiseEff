import type { PlaywrightTestConfig } from "playwright/test";

export type PlaywrightWebServerOptions = {
  baseURL: string;
  apiURL: string;
  reuseExistingServer: boolean;
  frontendCommand?: string;
  includeXiaozeProactive?: boolean;
  authMode?: "development" | "production";
};

export function portFromUrl(value: string, fallback: string) {
  try {
    return new URL(value).port || fallback;
  } catch {
    return fallback;
  }
}

export function resolveApiAuthorization() {
  return (
    process.env.VITE_WISEEFF_API_AUTHORIZATION ??
    process.env.M5_SMOKE_AUTHORIZATION ??
    process.env.WISEEFF_SMOKE_AUTHORIZATION
  );
}

export function resolveApiAuthProvider(apiAuthorization: string | undefined) {
  return apiAuthorization && process.env.AUTH_PROVIDER !== "oidc" ? "hmac" : process.env.AUTH_PROVIDER ?? "local";
}

export function buildPlaywrightWebServers({
  baseURL,
  apiURL,
  reuseExistingServer,
  frontendCommand = `npx vite --host 127.0.0.1 --port ${portFromUrl(baseURL, "5173")} --strictPort`,
  includeXiaozeProactive = false,
  authMode,
}: PlaywrightWebServerOptions): NonNullable<PlaywrightTestConfig["webServer"]> {
  const apiAuthorization = resolveApiAuthorization();
  const apiAuthProvider = resolveApiAuthProvider(apiAuthorization);
  const apiPort = portFromUrl(apiURL, "8787");

  return [
    {
      command: "npm run dev:api",
      env: {
        PORT: apiPort,
        XIAOZE_DETERMINISTIC: "true",
        AUTH_MODE: authMode ?? process.env.AUTH_MODE ?? "production",
        AUTH_PROVIDER: apiAuthProvider,
        ...(process.env.AUTH_TOKEN_ISSUER ? { AUTH_TOKEN_ISSUER: process.env.AUTH_TOKEN_ISSUER } : {}),
        ...(process.env.AUTH_TOKEN_HMAC_SECRET ? { AUTH_TOKEN_HMAC_SECRET: process.env.AUTH_TOKEN_HMAC_SECRET } : {}),
        ...(process.env.AUTH_OIDC_ISSUER ? { AUTH_OIDC_ISSUER: process.env.AUTH_OIDC_ISSUER } : {}),
        ...(process.env.AUTH_OIDC_AUDIENCE ? { AUTH_OIDC_AUDIENCE: process.env.AUTH_OIDC_AUDIENCE } : {}),
        ...(process.env.AUTH_OIDC_JWKS_URI ? { AUTH_OIDC_JWKS_URI: process.env.AUTH_OIDC_JWKS_URI } : {}),
        VITE_WISEEFF_RUNTIME_MODE: "api",
        VITE_WISEEFF_API_BASE_URL: apiURL,
        OBJECT_STORE_ROOT: process.env.OBJECT_STORE_ROOT ?? ".wiseeff-object-store",
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
        ...(includeXiaozeProactive
          ? { XIAOZE_PROACTIVE_ENABLED: process.env.XIAOZE_PROACTIVE_ENABLED ?? "true" }
          : {})
      },
      url: `${apiURL}/api/v1/health`,
      reuseExistingServer,
      timeout: 60_000
    },
    {
      command: frontendCommand,
      env: {
        VITE_WISEEFF_RUNTIME_MODE: "api",
        VITE_WISEEFF_API_BASE_URL: apiURL,
        ...(includeXiaozeProactive
          ? { VITE_XIAOZE_PROACTIVE_ENABLED: process.env.VITE_XIAOZE_PROACTIVE_ENABLED ?? "true" }
          : {}),
        ...(apiAuthorization ? { VITE_WISEEFF_API_AUTHORIZATION: apiAuthorization } : {})
      },
      url: baseURL,
      reuseExistingServer,
      timeout: 60_000
    }
  ];
}
