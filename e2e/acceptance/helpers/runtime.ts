export type AcceptanceRuntimeEnv = Record<string, string | undefined>;

const defaultApiBaseUrl = "http://127.0.0.1:8787";

export function apiBaseUrl(env: AcceptanceRuntimeEnv = process.env) {
  return env.VITE_WISEEFF_API_BASE_URL?.trim() || env.WISEEFF_API_BASE_URL?.trim() || defaultApiBaseUrl;
}

export function apiRoute(route: string, env: AcceptanceRuntimeEnv = process.env) {
  const base = apiBaseUrl(env).replace(/\/+$/, "");
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;

  return `${base}${normalizedRoute}`;
}

export function smokeHeaders(env: AcceptanceRuntimeEnv = process.env) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  const authorization = env.M5_SMOKE_AUTHORIZATION?.trim() || env.WISEEFF_SMOKE_AUTHORIZATION?.trim();

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}
