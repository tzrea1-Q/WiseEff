export type M5SmokeEnv = {
  WISEEFF_API_BASE_URL?: string;
  VITE_WISEEFF_API_BASE_URL?: string;
  M5_SMOKE_ALLOW_NO_API?: string;
  M5_SMOKE_AUTHORIZATION?: string;
  WISEEFF_SMOKE_AUTHORIZATION?: string;
  M5_SMOKE_USER_ID?: string;
  WISEEFF_SMOKE_USER_ID?: string;
};
type RuntimeEnv = Record<string, string | undefined>;

export type PilotReadinessBody = {
  ok?: unknown;
  status?: unknown;
  blockedBy?: unknown;
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

export function parseAllowedBlockedGates(argv: readonly string[], env: RuntimeEnv = process.env) {
  const prefix = "--allow-only-blocked=";
  const arg = argv.find((item) => item.startsWith(prefix));
  const value = arg ? arg.slice(prefix.length) : env.npm_config_allow_only_blocked;

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function canAcceptPilotReadiness(body: PilotReadinessBody, allowedBlockedGates: readonly string[]) {
  if (body.ok === true && body.status === "pilot_ready") {
    return true;
  }

  if (body.ok !== false || body.status !== "blocked" || !Array.isArray(body.blockedBy)) {
    return false;
  }

  const blockedBy = body.blockedBy.filter((item): item is string => typeof item === "string").sort();
  const allowed = [...allowedBlockedGates].sort();
  return blockedBy.length === allowed.length && blockedBy.every((gate, index) => gate === allowed[index]);
}

export function loadEnvContent(content: string, baseEnv: RuntimeEnv = process.env): RuntimeEnv {
  const env: RuntimeEnv = { ...baseEnv };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex).trim();
    if (!key || env[key]?.trim()) {
      continue;
    }

    env[key] = unquoteEnvValue(line.slice(separatorIndex + 1).trim());
  }

  return env;
}

function unquoteEnvValue(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}
