export type M5SmokeEnv = {
  WISEEFF_API_BASE_URL?: string;
  VITE_WISEEFF_API_BASE_URL?: string;
  M5_SMOKE_ALLOW_NO_API?: string;
  M5_SMOKE_AUTHORIZATION?: string;
  WISEEFF_SMOKE_AUTHORIZATION?: string;
  M5_SMOKE_USER_ID?: string;
  WISEEFF_SMOKE_USER_ID?: string;
};

export function resolveApiBaseUrl(env: M5SmokeEnv) {
  return env.WISEEFF_API_BASE_URL?.trim() ?? env.VITE_WISEEFF_API_BASE_URL?.trim() ?? "";
}

export function canSkipWithoutApi(env: M5SmokeEnv, argv: readonly string[] = process.argv.slice(2)) {
  if (argv.includes("--require-api")) {
    return false;
  }

  return env.M5_SMOKE_ALLOW_NO_API?.trim() === "true";
}

export function resolveHeaders(env: M5SmokeEnv) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  const authorization = env.M5_SMOKE_AUTHORIZATION?.trim() ?? env.WISEEFF_SMOKE_AUTHORIZATION?.trim();
  if (authorization) {
    headers.Authorization = authorization;
  }

  const userId = env.M5_SMOKE_USER_ID?.trim() ?? env.WISEEFF_SMOKE_USER_ID?.trim();
  if (userId) {
    headers["x-wiseeff-user"] = userId;
  }

  return headers;
}
