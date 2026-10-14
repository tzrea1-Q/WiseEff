import type { PlaywrightTestConfig } from "playwright/test";

export type PlaywrightWebServerOptions = {
  baseURL: string;
  apiURL: string;
  reuseExistingServer: boolean;
  frontendCommand?: string;
  includeXiaozeProactive?: boolean;
  projectConfigurationWorkbenchEnabled?: boolean;
  authMode?: "development" | "production";
};

export function portFromUrl(value: string, fallback: string) {
  try {
    return new URL(value).port || fallback;
  } catch {
    return fallback;
  }
}

export function resolveApiAuthorization(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.VITE_WISEEFF_API_AUTHORIZATION ??
    env.M5_SMOKE_AUTHORIZATION ??
    env.WISEEFF_SMOKE_AUTHORIZATION
  );
}

export function resolveApiAuthProvider(apiAuthorization: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  return apiAuthorization && env.AUTH_PROVIDER !== "oidc" ? "hmac" : env.AUTH_PROVIDER ?? "local";
}

export function buildPlaywrightWebServers({
  baseURL,
  apiURL,
  reuseExistingServer,
  frontendCommand = `npx vite --host 127.0.0.1 --port ${portFromUrl(baseURL, "5173")} --strictPort`,
  includeXiaozeProactive = false,
  projectConfigurationWorkbenchEnabled = false,
  authMode,
}: PlaywrightWebServerOptions, env: NodeJS.ProcessEnv = process.env): NonNullable<PlaywrightTestConfig["webServer"]> {
  const apiAuthorization = resolveApiAuthorization(env);
  const apiAuthProvider = resolveApiAuthProvider(apiAuthorization, env);
  const apiPort = portFromUrl(apiURL, "8787");

  return [
    {
      command: "npm run dev:api",
      env: {
        PORT: apiPort,
        XIAOZE_DETERMINISTIC: "true",
        // Loopback receivers (LOG-DOMAIN-WEBHOOK-001) need the local-development flag; the owned
        // acceptance runtime sets it too, so a root .env without it must not decide the result.
        LOG_WEBHOOK_ALLOW_INSECURE_LOCAL: "true",
        AUTH_MODE: authMode ?? env.AUTH_MODE ?? "production",
        AUTH_PROVIDER: apiAuthProvider,
        ...(env.AUTH_TOKEN_ISSUER ? { AUTH_TOKEN_ISSUER: env.AUTH_TOKEN_ISSUER } : {}),
        ...(env.AUTH_TOKEN_HMAC_SECRET ? { AUTH_TOKEN_HMAC_SECRET: env.AUTH_TOKEN_HMAC_SECRET } : {}),
        ...(env.AUTH_OIDC_ISSUER ? { AUTH_OIDC_ISSUER: env.AUTH_OIDC_ISSUER } : {}),
        ...(env.AUTH_OIDC_AUDIENCE ? { AUTH_OIDC_AUDIENCE: env.AUTH_OIDC_AUDIENCE } : {}),
        ...(env.AUTH_OIDC_JWKS_URI ? { AUTH_OIDC_JWKS_URI: env.AUTH_OIDC_JWKS_URI } : {}),
        VITE_WISEEFF_RUNTIME_MODE: "api",
        VITE_WISEEFF_API_BASE_URL: apiURL,
        OBJECT_STORE_ROOT: env.OBJECT_STORE_ROOT ?? ".wiseeff-object-store",
        ...(env.DATABASE_URL ? { DATABASE_URL: env.DATABASE_URL } : {}),
        ...(includeXiaozeProactive
          ? { XIAOZE_PROACTIVE_ENABLED: env.XIAOZE_PROACTIVE_ENABLED ?? "true" }
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
        VITE_WISEEFF_API_BASE_URL: env.WISEEFF_RUNTIME_LANE ? baseURL : apiURL,
        WISEEFF_DEV_API_PROXY_URL: apiURL,
        ...(projectConfigurationWorkbenchEnabled
          ? { VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED: "true" }
          : {}),
        ...(includeXiaozeProactive
          ? { VITE_XIAOZE_PROACTIVE_ENABLED: env.VITE_XIAOZE_PROACTIVE_ENABLED ?? "true" }
          : {}),
        ...(apiAuthorization ? { VITE_WISEEFF_API_AUTHORIZATION: apiAuthorization } : {})
      },
      url: baseURL,
      reuseExistingServer,
      timeout: 60_000
    }
  ];
}
