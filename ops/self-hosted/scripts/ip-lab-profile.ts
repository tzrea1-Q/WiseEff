import { randomBytes } from "node:crypto";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { resolveXiaozeLlmConfig } from "../../../server/config/xiaozeLlmConfig";

export const ipLabSeedOrganizationId = "org-chargelab";
export const ipLabSeedOrganizationName = "ChargeLab";
export const ipLabDeployProfile = "ip-lab";

export const requiredIpLabFiles = [
  "ops/self-hosted/Caddyfile.ip-lab",
  "ops/self-hosted/Caddyfile.ip-lab-tls",
  "ops/self-hosted/.env.ip-lab.example",
  "ops/self-hosted/scripts/init-ip-lab.ts",
  "ops/self-hosted/scripts/preflight-ip-lab.ts",
  "ops/self-hosted/scripts/provision-ip-lab.ts",
  "ops/self-hosted/scripts/deploy-ip-lab.sh",
  "ops/self-hosted/scripts/setup.sh",
  "ops/self-hosted/scripts/doctor.sh",
  "ops/self-hosted/scripts/selfhost-answers.ts",
  "ops/self-hosted/scripts/selfhost-profile.ts",
  "ops/self-hosted/scripts/setup-selfhost.ts",
  "ops/self-hosted/scripts/doctor-selfhost.ts",
  "ops/self-hosted/setup.md"
] as const;

export const requiredIpLabCaddyTokens = [
  ":80",
  "reverse_proxy api:8787",
  "reverse_proxy web:5173",
  "handle /api/*",
  "handle /health/*",
  "handle /downloads/device-bridge/*"
] as const;

export const forbiddenIpLabHttpCaddyTokens = ["tls {$WISEEFF_TLS_EMAIL}"] as const;

export const requiredIpLabTlsCaddyTokens = ["tls internal"] as const;

export type IpLabTlsMode = "http" | "internal";

export type IpLabInitInput = {
  host: string;
  tlsMode: IpLabTlsMode;
  adminUsername: string;
  adminPassword: string;
  postgresPassword: string;
  minioPassword: string;
  adminName?: string;
  seed?: "chargelab" | "none";
  agentApiBaseUrl?: string;
  agentModel?: string;
  agentApiKey?: string;
  logAnalysisApiBaseUrl?: string;
  logAnalysisModel?: string;
  logAnalysisApiKey?: string;
};

export type IpLabPreflightIssue = {
  level: "error" | "warning";
  message: string;
};

export type IpLabPreflightResult = {
  status: "passed" | "failed";
  issues: IpLabPreflightIssue[];
};

const urlSafeSecretPattern = /^[A-Za-z0-9_-]+$/;
const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function generateUrlSafeSecret(byteLength = 24) {
  return randomBytes(byteLength).toString("base64url");
}

export function publicUrlForLab(host: string, tlsMode: IpLabTlsMode) {
  const scheme = tlsMode === "internal" ? "https" : "http";
  return `${scheme}://${formatHostForUrl(host)}`;
}

export function caddyfileForTlsMode(tlsMode: IpLabTlsMode) {
  return tlsMode === "internal" ? "Caddyfile.ip-lab-tls" : "Caddyfile.ip-lab";
}

export function formatHostForUrl(host: string) {
  const trimmed = host.trim();
  if (trimmed.includes(":") && !trimmed.startsWith("[") && !ipv4Pattern.test(trimmed)) {
    return `[${trimmed}]`;
  }
  return trimmed;
}

export function isPrivateIpv4(host: string) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host.trim());
  if (!match) {
    return false;
  }
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) {
    return false;
  }
  const [first, second] = octets;
  return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

export function detectDefaultHost(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()
): string | undefined {
  const addresses: string[] = [];
  for (const nets of Object.values(interfaces)) {
    for (const net of nets ?? []) {
      const family = String(net.family);
      if ((family === "IPv4" || family === "4") && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses.find((address) => !isPrivateIpv4(address)) ?? addresses[0];
}

export function parseEnvText(text: string) {
  const env: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const separator = line.indexOf("=");
    env[line.slice(0, separator).trim()] = line.slice(separator + 1);
  }
  return env;
}

export function renderIpLabEnv(input: IpLabInitInput) {
  const host = input.host.trim();
  if (!host) {
    throw new Error("IP lab host is required.");
  }
  if (!urlSafeSecretPattern.test(input.postgresPassword)) {
    throw new Error("PostgreSQL password must be URL-safe ([A-Za-z0-9_-]).");
  }
  if (!urlSafeSecretPattern.test(input.minioPassword)) {
    throw new Error("MinIO password must be URL-safe ([A-Za-z0-9_-]).");
  }
  if (input.adminUsername.trim().length < 3) {
    throw new Error("Admin username must be at least 3 characters.");
  }
  if (input.adminPassword.length < 8) {
    throw new Error("Admin password must be at least 8 characters.");
  }

  const publicUrl = publicUrlForLab(host, input.tlsMode);
  const caddyfile = caddyfileForTlsMode(input.tlsMode);
  const adminName = input.adminName?.trim() || "Platform Admin";
  const seed = input.seed === "none" ? "none" : "chargelab";
  const agentApiBaseUrl = input.agentApiBaseUrl?.trim() ?? "";
  const agentModel = input.agentModel?.trim() ?? "";
  const agentApiKey = input.agentApiKey?.trim() ?? "";
  const logAnalysisApiBaseUrl = input.logAnalysisApiBaseUrl?.trim() ?? "";
  const logAnalysisModel = input.logAnalysisModel?.trim() ?? "";
  const logAnalysisApiKey = input.logAnalysisApiKey?.trim() ?? "";
  const xiaozeDeterministic = agentApiBaseUrl && agentApiKey ? "false" : "true";
  const logAnalysisDeterministic = logAnalysisApiBaseUrl && logAnalysisApiKey ? "false" : "true";

  return [
    "# WiseEff IP lab profile — HTTP or Caddy internal TLS, no public DNS required.",
    "# Generated by ops/self-hosted/scripts/setup.sh or init-ip-lab.ts.",
    "# This is a controlled lab profile, not a commercial-pilot or release-ready target.",
    "",
    `WISEEFF_DEPLOY_PROFILE=${ipLabDeployProfile}`,
    `WISEEFF_TLS_MODE=${input.tlsMode}`,
    `WISEEFF_CADDYFILE=${caddyfile}`,
    `WISEEFF_SITE_HOST=${host}`,
    "WISEEFF_TLS_EMAIL=unused-ip-lab@localhost",
    `WISEEFF_PUBLIC_URL=${publicUrl}`,
    `WISEEFF_LAB_ADMIN_USERNAME=${input.adminUsername.trim().toLowerCase()}`,
    `WISEEFF_LAB_ADMIN_PASSWORD=${input.adminPassword}`,
    `WISEEFF_LAB_ADMIN_NAME=${adminName}`,
    `WISEEFF_LAB_SEED=${seed}`,
    "",
    "NODE_ENV=production",
    "HOST=0.0.0.0",
    "PORT=8787",
    "",
    `POSTGRES_PASSWORD=${input.postgresPassword}`,
    `DATABASE_URL=postgres://wiseeff:${input.postgresPassword}@postgres:5432/wiseeff`,
    "",
    "AUTH_MODE=production",
    "AUTH_PROVIDER=local",
    "AUTH_OIDC_ISSUER=",
    "AUTH_OIDC_AUDIENCE=",
    "AUTH_OIDC_JWKS_URI=",
    "M6_SELFHOSTED_SMOKE_AUTHORIZATION=",
    "M6_IDENTITY_AUTHORIZATION=",
    "M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION=",
    "M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION=",
    "M6_IDENTITY_EXPIRED_AUTHORIZATION=",
    "M5_SMOKE_AUTHORIZATION=",
    "WISEEFF_SMOKE_AUTHORIZATION=",
    "",
    `WISEEFF_API_BASE_URL=${publicUrl}`,
    "VITE_WISEEFF_RUNTIME_MODE=api",
    `VITE_WISEEFF_API_BASE_URL=${publicUrl}`,
    "",
    "MINIO_ROOT_USER=wiseeff",
    `MINIO_ROOT_PASSWORD=${input.minioPassword}`,
    "OBJECT_STORE_MODE=s3",
    "OBJECT_STORAGE_ENDPOINT=http://minio:9000",
    "OBJECT_STORAGE_BUCKET=wiseeff",
    "OBJECT_STORAGE_ACCESS_KEY_ID=wiseeff",
    `OBJECT_STORAGE_SECRET_ACCESS_KEY=${input.minioPassword}`,
    "OBJECT_STORAGE_REGION=us-east-1",
    "OBJECT_STORAGE_TLS_POLICY=optional",
    "OBJECT_STORAGE_PATH_STYLE=true",
    "OBJECT_STORAGE_HEALTH_PREFIX=.health/",
    "OBJECT_STORAGE_RETENTION_CLASS=pilot-default",
    "",
    "BACKUP_DATABASE_TARGET=file:///var/backups/wiseeff/postgres/wiseeff.dump",
    "BACKUP_OBJECT_STORAGE_TARGET=file:///var/backups/wiseeff/object-store/",
    "RESTORE_DATABASE_URL=postgres://wiseeff_restore:restore-password@postgres:5432/wiseeff_restore",
    "RESTORE_OBJECT_STORAGE_BUCKET=wiseeff-restore",
    "RESTORE_OBJECT_STORAGE_PREFIX=m6-drill/",
    "",
    "DEBUG_DEVICE_GATEWAY_MODE=multi",
    "DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true",
    "HDC_TIMEOUT_MS=5000",
    "ADB_TIMEOUT_MS=5000",
    "",
    "DEVICE_BRIDGE_ARTIFACT_ROOT=ops/self-hosted/bridge-artifacts",
    "DEVICE_BRIDGE_TOOL_ARTIFACT_ROOT=ops/self-hosted/bridge-tool-artifacts",
    "DEVICE_BRIDGE_PAIRING_TTL_SECONDS=1800",
    "DEVICE_BRIDGE_TOKEN_TTL_DAYS=90",
    "DEVICE_BRIDGE_WS_PATH=/api/v1/device-bridges/ws",
    "DEVICE_BRIDGE_LAB_AVAILABLE=false",
    `DEVICE_BRIDGE_SERVER_URL=${publicUrl}`,
    "",
    `XIAOZE_LLM_API_BASE_URL=${agentApiBaseUrl}`,
    `XIAOZE_LLM_MODEL=${agentModel}`,
    `XIAOZE_LLM_API_KEY=${agentApiKey}`,
    "AGENT_API_TIMEOUT_MS=30000",
    "XIAOZE_CHECKPOINTER=postgres",
    `XIAOZE_DETERMINISTIC=${xiaozeDeterministic}`,
    "",
    `LOG_ANALYSIS_API_BASE_URL=${logAnalysisApiBaseUrl}`,
    `LOG_ANALYSIS_MODEL=${logAnalysisModel}`,
    `LOG_ANALYSIS_API_KEY=${logAnalysisApiKey}`,
    "LOG_ANALYSIS_API_TIMEOUT_MS=30000",
    "LOG_ANALYSIS_TOKEN_BUDGET=8000",
    `LOG_ANALYSIS_DETERMINISTIC=${logAnalysisDeterministic}`,
    "",
    "LOG_WORKER_ENABLED=false",
    "LOG_ANALYSIS_QUEUE_MODE=durable",
    "REDIS_URL=redis://redis:6379",
    "LOG_ANALYSIS_QUEUE_PREFIX=wiseeff",
    "LOG_ANALYSIS_QUEUE_ATTEMPTS=4",
    "LOG_ANALYSIS_QUEUE_BACKOFF_MS=1000",
    "LOG_ANALYSIS_QUEUE_CONCURRENCY=1",
    "",
    "M5_CONTRACT_CHECK_PASSED=true",
    "M5_BACKUP_RESTORE_DRILL_AT=",
    "M5_SMOKE_ALLOW_NO_API=false",
    ""
  ].join("\n");
}

export function evaluateIpLabEnv(env: Record<string, string | undefined>): IpLabPreflightResult {
  const issues: IpLabPreflightIssue[] = [];
  const requireValue = (key: string) => {
    const value = env[key]?.trim();
    if (!value) {
      issues.push({ level: "error", message: `${key} is required for the IP lab profile.` });
    }
    return value;
  };

  if ((env.WISEEFF_DEPLOY_PROFILE ?? "").trim() !== ipLabDeployProfile) {
    issues.push({ level: "error", message: "WISEEFF_DEPLOY_PROFILE must be ip-lab." });
  }
  if ((env.NODE_ENV ?? "").trim() !== "production") {
    issues.push({ level: "error", message: "NODE_ENV must be production." });
  }
  if ((env.AUTH_MODE ?? "").trim() !== "production") {
    issues.push({ level: "error", message: "AUTH_MODE must be production." });
  }
  if ((env.AUTH_PROVIDER ?? "").trim() !== "local") {
    issues.push({ level: "error", message: "AUTH_PROVIDER must be local for the IP lab profile." });
  }

  const host = requireValue("WISEEFF_SITE_HOST");
  const tlsMode = (env.WISEEFF_TLS_MODE ?? "http").trim();
  if (tlsMode !== "http" && tlsMode !== "internal") {
    issues.push({ level: "error", message: "WISEEFF_TLS_MODE must be http or internal." });
  }
  const expectedCaddyfile = caddyfileForTlsMode(tlsMode === "internal" ? "internal" : "http");
  if ((env.WISEEFF_CADDYFILE ?? "").trim() !== expectedCaddyfile) {
    issues.push({
      level: "error",
      message: `WISEEFF_CADDYFILE must be ${expectedCaddyfile} when WISEEFF_TLS_MODE=${tlsMode || "http"}.`
    });
  }

  const publicUrl = requireValue("WISEEFF_PUBLIC_URL");
  const apiUrl = requireValue("WISEEFF_API_BASE_URL");
  const viteUrl = requireValue("VITE_WISEEFF_API_BASE_URL");
  const bridgeUrl = requireValue("DEVICE_BRIDGE_SERVER_URL");
  if (host && publicUrl) {
    const expected = publicUrlForLab(host, tlsMode === "internal" ? "internal" : "http");
    if (publicUrl !== expected) {
      issues.push({
        level: "error",
        message: `WISEEFF_PUBLIC_URL must be ${expected} for host ${host} and TLS mode ${tlsMode || "http"}.`
      });
    }
  }
  for (const [key, value] of [
    ["WISEEFF_API_BASE_URL", apiUrl],
    ["VITE_WISEEFF_API_BASE_URL", viteUrl],
    ["DEVICE_BRIDGE_SERVER_URL", bridgeUrl]
  ] as const) {
    if (publicUrl && value && value !== publicUrl) {
      issues.push({ level: "error", message: `${key} must match WISEEFF_PUBLIC_URL.` });
    }
  }

  const postgresPassword = requireValue("POSTGRES_PASSWORD");
  if (postgresPassword && !urlSafeSecretPattern.test(postgresPassword)) {
    issues.push({
      level: "error",
      message: "POSTGRES_PASSWORD must be URL-safe ([A-Za-z0-9_-]) so DATABASE_URL stays valid."
    });
  }
  const databaseUrl = requireValue("DATABASE_URL");
  if (postgresPassword && databaseUrl && !databaseUrl.includes(postgresPassword)) {
    issues.push({ level: "error", message: "DATABASE_URL must embed the expanded POSTGRES_PASSWORD." });
  }

  const minioPassword = requireValue("MINIO_ROOT_PASSWORD");
  const objectSecret = requireValue("OBJECT_STORAGE_SECRET_ACCESS_KEY");
  if (minioPassword && objectSecret && minioPassword !== objectSecret) {
    issues.push({
      level: "error",
      message: "OBJECT_STORAGE_SECRET_ACCESS_KEY must match MINIO_ROOT_PASSWORD."
    });
  }
  const objectEndpoint = requireValue("OBJECT_STORAGE_ENDPOINT");
  if (objectEndpoint && !objectEndpoint.startsWith("http://minio")) {
    issues.push({
      level: "error",
      message: "OBJECT_STORAGE_ENDPOINT must point at the compose MinIO service (http://minio:9000)."
    });
  }

  requireValue("WISEEFF_LAB_ADMIN_USERNAME");
  const adminPassword = requireValue("WISEEFF_LAB_ADMIN_PASSWORD");
  if (adminPassword && adminPassword.length < 8) {
    issues.push({ level: "error", message: "WISEEFF_LAB_ADMIN_PASSWORD must be at least 8 characters." });
  }

  if ((env.XIAOZE_CHECKPOINTER ?? "").trim() !== "postgres") {
    issues.push({ level: "error", message: "XIAOZE_CHECKPOINTER must be postgres." });
  }
  const xiaozeLlm = resolveXiaozeLlmConfig(env).config;
  const xiaozeReady =
    (env.XIAOZE_DETERMINISTIC ?? "").trim() === "true" ||
    Boolean(xiaozeLlm.apiBaseUrl && xiaozeLlm.apiKey);
  if (!xiaozeReady) {
    issues.push({
      level: "error",
      message: "Set XIAOZE_DETERMINISTIC=true or provide XIAOZE_LLM_API_BASE_URL and XIAOZE_LLM_API_KEY."
    });
  }
  const logAnalysisReady =
    (env.LOG_ANALYSIS_DETERMINISTIC ?? "").trim() === "true" ||
    Boolean(env.LOG_ANALYSIS_API_BASE_URL?.trim() && env.LOG_ANALYSIS_API_KEY?.trim());
  if (!logAnalysisReady) {
    issues.push({
      level: "error",
      message:
        "Set LOG_ANALYSIS_DETERMINISTIC=true or provide LOG_ANALYSIS_API_BASE_URL and LOG_ANALYSIS_API_KEY."
    });
  }

  if ((env.LOG_ANALYSIS_QUEUE_MODE ?? "").trim() !== "durable") {
    issues.push({ level: "error", message: "LOG_ANALYSIS_QUEUE_MODE must be durable." });
  }
  requireValue("REDIS_URL");

  if (host && (host === "127.0.0.1" || host === "localhost" || host === "::1")) {
    issues.push({
      level: "warning",
      message: "WISEEFF_SITE_HOST is a loopback address; browsers on other machines cannot reach this lab."
    });
  } else if (host && isPrivateIpv4(host)) {
    issues.push({
      level: "warning",
      message: "WISEEFF_SITE_HOST is a private IPv4 address. Use --ip <public-ip> if clients are off-LAN."
    });
  }
  if (publicUrl?.startsWith("http://") && host && !isPrivateIpv4(host) && host !== "127.0.0.1") {
    issues.push({
      level: "warning",
      message: "IP lab HTTP mode sends plaintext traffic. Restrict port 80 or use --tls-mode internal."
    });
  }

  return {
    status: issues.some((issue) => issue.level === "error") ? "failed" : "passed",
    issues
  };
}

export function evaluateIpLabCaddyfile(text: string, tlsMode: IpLabTlsMode) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const missingTokens = requiredIpLabCaddyTokens.filter((token) => !normalized.includes(token));
  const forbidden =
    tlsMode === "http"
      ? forbiddenIpLabHttpCaddyTokens.filter((token) => normalized.includes(token))
      : [];
  const missingTlsTokens =
    tlsMode === "internal" ? requiredIpLabTlsCaddyTokens.filter((token) => !normalized.includes(token)) : [];

  return {
    status: missingTokens.length === 0 && forbidden.length === 0 && missingTlsTokens.length === 0 ? "passed" : "failed",
    missingTokens: [...missingTokens, ...missingTlsTokens],
    forbiddenTokens: forbidden
  };
}

export function parseIpLabCliArgs(args: readonly string[]) {
  const options = {
    host: "",
    tlsMode: "http" as IpLabTlsMode,
    adminUsername: "admin.ops",
    adminPassword: "",
    envFile: "ops/self-hosted/.env",
    force: false,
    printEnv: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if ((arg === "--host" || arg === "--ip") && next) {
      options.host = next;
      index += 1;
    } else if (arg === "--tls-mode" && next) {
      if (next !== "http" && next !== "internal") {
        throw new Error("TLS mode must be http or internal.");
      }
      options.tlsMode = next;
      index += 1;
    } else if (arg === "--admin-username" && next) {
      options.adminUsername = next;
      index += 1;
    } else if (arg === "--admin-password" && next) {
      options.adminPassword = next;
      index += 1;
    } else if (arg === "--env-file" && next) {
      options.envFile = next;
      index += 1;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--print-env") {
      options.printEnv = true;
    } else {
      throw new Error(`Unknown or incomplete IP lab argument: ${arg}`);
    }
  }

  return options;
}
