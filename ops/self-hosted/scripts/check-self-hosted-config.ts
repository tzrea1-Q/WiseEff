import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const requiredSelfHostedScripts = [
  "selfhost:check",
  "selfhost:smoke",
  "backup:drill",
  "restore:drill",
  "backup:check",
  "queue:check",
  "dtc:check",
  "dtc:seed:compile",
  "dts:toolchain:check",
  "dts:config:validate"
] as const;

export const requiredSelfHostedServices = ["postgres", "redis", "api", "worker", "web", "proxy"] as const;

export const requiredSelfHostedFiles = ["ops/self-hosted/scripts/compose"] as const;

export const requiredComposeTokens = [
  'version: "3.8"',
  "wiseeff-postgres-data:/var/lib/postgresql/data",
  "wiseeff-redis-data:/data",
  "env_file: .env",
  "redis-server",
  "VITE_WISEEFF_RUNTIME_MODE: api",
  "VITE_WISEEFF_API_BASE_URL: ${VITE_WISEEFF_API_BASE_URL:?set VITE_WISEEFF_API_BASE_URL in ops/self-hosted/.env}",
  "curl -fsS http://127.0.0.1:8787/health/live",
  "curl -fsS http://127.0.0.1:5173/",
  "wget -q --spider",
  "wget -q --spider http://127.0.0.1:2019/config/",
  "npm run worker:logs",
  "npm run preview -- --host 0.0.0.0 --port 5173 --strictPort",
  "80:80",
  "443:443"
] as const;

export const requiredDockerfileTokens = [
  "FROM node:>=22.19.0",
  "ARG VITE_WISEEFF_RUNTIME_MODE=api",
  "ARG VITE_WISEEFF_API_BASE_URL",
  "ENV VITE_WISEEFF_RUNTIME_MODE=$VITE_WISEEFF_RUNTIME_MODE",
  "ENV VITE_WISEEFF_API_BASE_URL=$VITE_WISEEFF_API_BASE_URL",
  "ARG DTC_COMMIT=8f48565e5cfedc74d3f7512f1e0188e9d85dc1de",
  "pip3 install --break-system-packages --no-cache-dir -r /tmp/dts-toolchain-requirements.txt",
  "COPY --from=dtc-builder /opt/dtc /opt/dtc",
  "RUN dtc --version && fdtoverlay --version && dt-validate --version",
  "npx tsc -b",
  "npx vite build"
] as const;

export const requiredDockerignoreTokens = ["**/.env", "**/.env.*", ".git/"] as const;

export const requiredEnvKeys = [
  "NODE_ENV",
  "HOST",
  "PORT",
  "POSTGRES_PASSWORD",
  "DATABASE_URL",
  "AUTH_MODE",
  "AUTH_PROVIDER",
  "AUTH_OIDC_ISSUER",
  "AUTH_OIDC_AUDIENCE",
  "AUTH_OIDC_JWKS_URI",
  "M6_SELFHOSTED_SMOKE_AUTHORIZATION",
  "VITE_WISEEFF_RUNTIME_MODE",
  "VITE_WISEEFF_API_BASE_URL",
  "OBJECT_STORE_MODE",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  "OBJECT_STORAGE_TLS_POLICY",
  "OBJECT_STORAGE_PATH_STYLE",
  "OBJECT_STORAGE_HEALTH_PREFIX",
  "OBJECT_STORAGE_RETENTION_CLASS",
  "BACKUP_DATABASE_TARGET",
  "BACKUP_OBJECT_STORAGE_TARGET",
  "RESTORE_DATABASE_URL",
  "RESTORE_OBJECT_STORAGE_BUCKET",
  "RESTORE_OBJECT_STORAGE_PREFIX",
  "DEBUG_DEVICE_GATEWAY_MODE",
  "DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION",
  "AGENT_API_BASE_URL",
  "AGENT_MODEL",
  "AGENT_API_KEY",
  "AGENT_API_TIMEOUT_MS",
  "XIAOZE_CHECKPOINTER",
  "LOG_WORKER_ENABLED",
  "LOG_ANALYSIS_QUEUE_MODE",
  "REDIS_URL",
  "LOG_ANALYSIS_QUEUE_PREFIX",
  "LOG_ANALYSIS_QUEUE_ATTEMPTS",
  "LOG_ANALYSIS_QUEUE_BACKOFF_MS",
  "LOG_ANALYSIS_QUEUE_CONCURRENCY",
  "M5_BACKUP_RESTORE_DRILL_AT"
] as const;

export const requiredSelfHostedStorageFiles = [
  "ops/self-hosted/storage/README.md",
  "ops/self-hosted/storage/provider-decision.md",
  "ops/self-hosted/storage/object-store.env.example"
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
  existingFiles?: Set<string>;
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
  missingFiles: string[];
};

export function evaluateSelfHostedConfig(input: SelfHostedConfigInput): SelfHostedConfigResult {
  const scripts = input.packageJson.scripts ?? {};
  const composeText = normalize(input.composeText);
  const dockerfileText = normalize(input.dockerfileText);
  const dockerignoreText = normalize(input.dockerignoreText);
  const caddyfileText = normalize(input.caddyfileText);
  const envKeys = parseEnvKeys(input.envExampleText);
  const existingFiles =
    input.existingFiles ??
    new Set(
      [...requiredSelfHostedStorageFiles, ...requiredSelfHostedFiles].filter((filePath) => existsSync(filePath))
    );

  const missingScripts = requiredSelfHostedScripts.filter((script) => !scripts[script]);
  const missingServices = requiredSelfHostedServices.filter((service) => !hasComposeService(composeText, service));
  const missingComposeTokens = requiredComposeTokens.filter((token) => !composeText.includes(normalize(token)));
  const missingDockerfileTokens = requiredDockerfileTokens.filter((token) =>
    token === "FROM node:>=22.19.0" ? !hasRequiredNodeRuntime(dockerfileText) : !dockerfileText.includes(normalize(token))
  );
  const missingDockerignoreTokens = requiredDockerignoreTokens.filter((token) => !dockerignoreText.includes(normalize(token)));
  const missingEnvKeys = requiredEnvKeys.filter((key) => !envKeys.has(key));
  const missingProxyTokens = requiredProxyTokens.filter((token) => !caddyfileText.includes(normalize(token)));
  const missingFiles = [...requiredSelfHostedStorageFiles, ...requiredSelfHostedFiles].filter(
    (filePath) => !existingFiles.has(filePath)
  );

  return {
    status:
      missingScripts.length === 0 &&
      missingServices.length === 0 &&
      missingComposeTokens.length === 0 &&
      missingDockerfileTokens.length === 0 &&
      missingDockerignoreTokens.length === 0 &&
      missingEnvKeys.length === 0 &&
      missingProxyTokens.length === 0 &&
      missingFiles.length === 0
        ? "passed"
        : "failed",
    missingScripts,
    missingServices,
    missingComposeTokens,
    missingDockerfileTokens,
    missingDockerignoreTokens,
    missingEnvKeys,
    missingProxyTokens,
    missingFiles
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

function hasRequiredNodeRuntime(normalizedDockerfileText: string) {
  const matches = [...normalizedDockerfileText.matchAll(/(?:^|\n)FROM node:(\d+)(?:\.(\d+))?(?:\.(\d+))?[-\w.]*\b/g)];
  if (matches.length === 0) {
    return false;
  }

  return matches.every((match) => {
    const major = Number(match[1]);
    const minor = match[2] === undefined ? undefined : Number(match[2]);
    const patch = match[3] === undefined ? undefined : Number(match[3]);

    if (!Number.isInteger(major) || major > 22) {
      return Number.isInteger(major) && major > 22;
    }
    if (major < 22 || minor === undefined || patch === undefined) {
      return false;
    }
    if (minor > 19) {
      return true;
    }
    return minor === 19 && patch >= 0;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runSelfHostedConfigCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
