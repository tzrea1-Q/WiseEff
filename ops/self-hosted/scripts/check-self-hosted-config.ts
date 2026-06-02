import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const requiredSelfHostedScripts = ["selfhost:check", "selfhost:smoke", "queue:check"] as const;

export const requiredSelfHostedServices = ["postgres", "redis", "api", "worker", "web", "proxy"] as const;

export const requiredComposeTokens = [
  "wiseeff-postgres-data:/var/lib/postgresql/data",
  "wiseeff-redis-data:/data",
  "env_file: .env",
  "redis-server",
  "VITE_WISEEFF_RUNTIME_MODE: api",
  "VITE_WISEEFF_API_BASE_URL: ${VITE_WISEEFF_API_BASE_URL:?set VITE_WISEEFF_API_BASE_URL in ops/self-hosted/.env}",
  "curl -fsS http://127.0.0.1:8787/health/live",
  "curl -fsS http://127.0.0.1:5173/",
  "wget -q --spider",
  "Host: ${WISEEFF_SITE_HOST}",
  "npm run worker:logs",
  "npm run preview -- --host 0.0.0.0 --port 5173 --strictPort",
  "80:80",
  "443:443"
] as const;

export const requiredDockerfileTokens = [
  "ARG VITE_WISEEFF_RUNTIME_MODE=api",
  "ARG VITE_WISEEFF_API_BASE_URL",
  "ENV VITE_WISEEFF_RUNTIME_MODE=$VITE_WISEEFF_RUNTIME_MODE",
  "ENV VITE_WISEEFF_API_BASE_URL=$VITE_WISEEFF_API_BASE_URL",
  "RUN apk add --no-cache curl",
  "RUN npm run build"
] as const;

export const requiredDockerignoreTokens = ["**/.env", "**/.env.*", ".git/"] as const;

export const requiredEnvKeys = [
  "NODE_ENV",
  "HOST",
  "PORT",
  "POSTGRES_PASSWORD",
  "DATABASE_URL",
  "AUTH_MODE",
  "AUTH_TOKEN_ISSUER",
  "AUTH_TOKEN_HMAC_SECRET",
  "VITE_WISEEFF_RUNTIME_MODE",
  "VITE_WISEEFF_API_BASE_URL",
  "OBJECT_STORE_MODE",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  "DEBUG_DEVICE_GATEWAY_MODE",
  "DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION",
  "AGENT_PROVIDER",
  "AGENT_API_FORMAT",
  "AGENT_API_BASE_URL",
  "AGENT_MODEL",
  "AGENT_API_KEY",
  "LOG_WORKER_ENABLED",
  "LOG_ANALYSIS_QUEUE_MODE",
  "REDIS_URL",
  "LOG_ANALYSIS_QUEUE_PREFIX",
  "LOG_ANALYSIS_QUEUE_ATTEMPTS",
  "LOG_ANALYSIS_QUEUE_BACKOFF_MS",
  "LOG_ANALYSIS_QUEUE_CONCURRENCY",
  "M5_BACKUP_RESTORE_DRILL_AT"
] as const;

export const requiredProxyTokens = [
  "{$WISEEFF_SITE_HOST}",
  "tls",
  "reverse_proxy api:8787",
  "reverse_proxy web:5173",
  "handle /api/*",
  "handle /health/*"
] as const;

export type SelfHostedConfigInput = {
  packageJson: {
    scripts?: Record<string, string>;
  };
  composeText: string;
  dockerfileText: string;
  dockerignoreText: string;
  envExampleText: string;
  caddyfileText: string;
};

export type SelfHostedConfigResult = {
  status: "passed" | "failed";
  missingScripts: string[];
  missingServices: string[];
  missingComposeTokens: string[];
  missingDockerfileTokens: string[];
  missingDockerignoreTokens: string[];
  missingEnvKeys: string[];
  missingProxyTokens: string[];
};

export function evaluateSelfHostedConfig(input: SelfHostedConfigInput): SelfHostedConfigResult {
  const scripts = input.packageJson.scripts ?? {};
  const composeText = normalize(input.composeText);
  const dockerfileText = normalize(input.dockerfileText);
  const dockerignoreText = normalize(input.dockerignoreText);
  const caddyfileText = normalize(input.caddyfileText);
  const envKeys = parseEnvKeys(input.envExampleText);

  const missingScripts = requiredSelfHostedScripts.filter((script) => !scripts[script]);
  const missingServices = requiredSelfHostedServices.filter((service) => !hasComposeService(composeText, service));
  const missingComposeTokens = requiredComposeTokens.filter((token) => !composeText.includes(normalize(token)));
  const missingDockerfileTokens = requiredDockerfileTokens.filter((token) => !dockerfileText.includes(normalize(token)));
  const missingDockerignoreTokens = requiredDockerignoreTokens.filter((token) => !dockerignoreText.includes(normalize(token)));
  const missingEnvKeys = requiredEnvKeys.filter((key) => !envKeys.has(key));
  const missingProxyTokens = requiredProxyTokens.filter((token) => !caddyfileText.includes(normalize(token)));

  return {
    status:
      missingScripts.length === 0 &&
      missingServices.length === 0 &&
      missingComposeTokens.length === 0 &&
      missingDockerfileTokens.length === 0 &&
      missingDockerignoreTokens.length === 0 &&
      missingEnvKeys.length === 0 &&
      missingProxyTokens.length === 0
        ? "passed"
        : "failed",
    missingScripts,
    missingServices,
    missingComposeTokens,
    missingDockerfileTokens,
    missingDockerignoreTokens,
    missingEnvKeys,
    missingProxyTokens
  };
}

export function runSelfHostedConfigCheck() {
  const paths = {
    compose: "ops/self-hosted/compose.yaml",
    dockerfile: "ops/self-hosted/Dockerfile",
    dockerignore: ".dockerignore",
    envExample: "ops/self-hosted/.env.example",
    caddyfile: "ops/self-hosted/Caddyfile.example",
    packageJson: "package.json"
  };

  for (const [label, filePath] of Object.entries(paths)) {
    if (!existsSync(filePath)) {
      throw new Error(`Missing ${label} file: ${filePath}`);
    }
  }

  const packageJson = JSON.parse(readFileSync(paths.packageJson, "utf8")) as SelfHostedConfigInput["packageJson"];
  const result = evaluateSelfHostedConfig({
    packageJson,
    composeText: readFileSync(paths.compose, "utf8"),
    dockerfileText: readFileSync(paths.dockerfile, "utf8"),
    dockerignoreText: readFileSync(paths.dockerignore, "utf8"),
    envExampleText: readFileSync(paths.envExample, "utf8"),
    caddyfileText: readFileSync(paths.caddyfile, "utf8")
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

function parseEnvKeys(text: string) {
  const keys = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    keys.add(line.slice(0, line.indexOf("=")).trim());
  }

  return keys;
}

function hasComposeService(normalizedComposeText: string, service: string) {
  return new RegExp(`(^|\\n) ${service}:\\n`).test(normalizedComposeText);
}

function normalize(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runSelfHostedConfigCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
