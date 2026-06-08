import { describe, expect, it } from "vitest";
import { evaluateSelfHostedConfig } from "./check-self-hosted-config";

const validPackageJson = {
  scripts: {
    "backup:check": "tsx scripts/check-backup-drill.ts",
    "backup:drill": "tsx scripts/run-backup-drill.ts",
    "queue:check": "tsx scripts/check-durable-queue.ts",
    "restore:drill": "tsx scripts/run-restore-drill.ts",
    "selfhost:check": "tsx ops/self-hosted/scripts/check-self-hosted-config.ts",
    "selfhost:smoke": "tsx ops/self-hosted/scripts/run-self-hosted-smoke.ts"
  }
};

const validCompose = `
x-wiseeff-build: &wiseeff-build
  context: ../..
  dockerfile: ops/self-hosted/Dockerfile
  args:
    VITE_WISEEFF_RUNTIME_MODE: api
    VITE_WISEEFF_API_BASE_URL: \${VITE_WISEEFF_API_BASE_URL:?set VITE_WISEEFF_API_BASE_URL in ops/self-hosted/.env}
services:
  postgres:
    image: postgres:16-alpine
    env_file: .env
    volumes:
      - wiseeff-postgres-data:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - wiseeff-redis-data:/data
  api:
    build: *wiseeff-build
    env_file: .env
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:8787/health/live"]
    command: ["sh", "-lc", "npx tsx server/index.ts"]
  worker:
    build: *wiseeff-build
    env_file: .env
    command: ["sh", "-lc", "npm run worker:logs"]
    depends_on:
      redis:
        condition: service_healthy
  web:
    build: *wiseeff-build
    env_file: .env
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:5173/"]
    command: ["sh", "-lc", "npm run preview -- --host 0.0.0.0 --port 5173 --strictPort"]
  proxy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider --header=\"Host: \${WISEEFF_SITE_HOST}\" http://127.0.0.1/health/live"]
volumes:
  wiseeff-postgres-data:
`;

const validDockerfile = `
FROM node:22-alpine
ARG VITE_WISEEFF_RUNTIME_MODE=api
ARG VITE_WISEEFF_API_BASE_URL
ENV VITE_WISEEFF_RUNTIME_MODE=$VITE_WISEEFF_RUNTIME_MODE
ENV VITE_WISEEFF_API_BASE_URL=$VITE_WISEEFF_API_BASE_URL
RUN apk add --no-cache curl
RUN npm run build
`;

const validDockerignore = `
node_modules/
dist/
.git/
**/.env
**/.env.*
`;

const validEnvExample = `
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
POSTGRES_PASSWORD=
DATABASE_URL=
AUTH_MODE=production
AUTH_PROVIDER=oidc
AUTH_OIDC_ISSUER=https://id.example.com/realms/wiseeff
AUTH_OIDC_AUDIENCE=wiseeff-api
AUTH_OIDC_JWKS_URI=
M6_SELFHOSTED_SMOKE_AUTHORIZATION=
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=
OBJECT_STORE_MODE=s3
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_TLS_POLICY=required
OBJECT_STORAGE_PATH_STYLE=true
OBJECT_STORAGE_HEALTH_PREFIX=.health/
OBJECT_STORAGE_RETENTION_CLASS=pilot-default
BACKUP_DATABASE_TARGET=
BACKUP_OBJECT_STORAGE_TARGET=
RESTORE_DATABASE_URL=
RESTORE_OBJECT_STORAGE_BUCKET=
RESTORE_OBJECT_STORAGE_PREFIX=
DEBUG_DEVICE_GATEWAY_MODE=simulator
DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true
AGENT_PROVIDER=live
AGENT_API_FORMAT=openai
AGENT_API_BASE_URL=
AGENT_MODEL=
AGENT_API_KEY=
LOG_WORKER_ENABLED=false
LOG_ANALYSIS_QUEUE_MODE=durable
REDIS_URL=redis://redis:6379
LOG_ANALYSIS_QUEUE_PREFIX=wiseeff
LOG_ANALYSIS_QUEUE_ATTEMPTS=4
LOG_ANALYSIS_QUEUE_BACKOFF_MS=1000
LOG_ANALYSIS_QUEUE_CONCURRENCY=1
M5_BACKUP_RESTORE_DRILL_AT=
`;

const validCaddyfile = `
{
  email {$WISEEFF_TLS_EMAIL}
}
{$WISEEFF_SITE_HOST} {
  tls {$WISEEFF_TLS_EMAIL}
  handle /api/* {
    reverse_proxy api:8787
  }
  handle /health/* {
    reverse_proxy api:8787
  }
  handle {
    reverse_proxy web:5173
  }
}
`;

describe("self-hosted config metadata", () => {
  it("passes when compose, env, proxy, and package scripts describe a self-hosted runtime", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose,
      dockerfileText: validDockerfile,
      dockerignoreText: validDockerignore,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile
      ,
      existingFiles: new Set([
        "ops/self-hosted/storage/README.md",
        "ops/self-hosted/storage/provider-decision.md",
        "ops/self-hosted/storage/object-store.env.example"
      ])
    });

    expect(result).toEqual({
      status: "passed",
      missingScripts: [],
      missingServices: [],
      missingComposeTokens: [],
      missingDockerfileTokens: [],
      missingDockerignoreTokens: [],
      missingEnvKeys: [],
      missingProxyTokens: [],
      missingFiles: []
    });
  });

  it("reports all missing self-hosted runtime requirements", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: { scripts: {} },
      composeText: "services:\n  api:\n    image: node:20-alpine\n",
      dockerfileText: "FROM node:22-alpine\nCOPY . .\nRUN npm run build\n",
      dockerignoreText: "node_modules/\n",
      envExampleText: "NODE_ENV=production\n",
      caddyfileText: "",
      existingFiles: new Set()
    });

    expect(result.status).toBe("failed");
    expect(result.missingScripts).toEqual(["selfhost:check", "selfhost:smoke", "backup:drill", "restore:drill", "backup:check", "queue:check"]);
    expect(result.missingServices).toEqual(["postgres", "redis", "worker", "web", "proxy"]);
    expect(result.missingComposeTokens).toEqual(
      expect.arrayContaining([
        "wiseeff-postgres-data:/var/lib/postgresql/data",
        "wiseeff-redis-data:/data",
        "env_file: .env",
        "redis-server",
        "npm run worker:logs",
        "VITE_WISEEFF_API_BASE_URL: ${VITE_WISEEFF_API_BASE_URL:?set VITE_WISEEFF_API_BASE_URL in ops/self-hosted/.env}"
      ])
    );
    expect(result.missingDockerfileTokens).toEqual(expect.arrayContaining(["ARG VITE_WISEEFF_API_BASE_URL"]));
    expect(result.missingDockerignoreTokens).toEqual(expect.arrayContaining(["**/.env", "**/.env.*"]));
    expect(result.missingEnvKeys).toEqual(
      expect.arrayContaining([
        "HOST",
        "DATABASE_URL",
        "AUTH_PROVIDER",
        "AUTH_OIDC_ISSUER",
        "AUTH_OIDC_AUDIENCE",
        "AUTH_OIDC_JWKS_URI",
        "M6_SELFHOSTED_SMOKE_AUTHORIZATION",
        "LOG_WORKER_ENABLED",
        "M5_BACKUP_RESTORE_DRILL_AT",
        "OBJECT_STORAGE_TLS_POLICY",
        "OBJECT_STORAGE_PATH_STYLE",
        "OBJECT_STORAGE_HEALTH_PREFIX",
        "BACKUP_DATABASE_TARGET",
        "BACKUP_OBJECT_STORAGE_TARGET",
        "RESTORE_DATABASE_URL",
        "RESTORE_OBJECT_STORAGE_BUCKET",
        "RESTORE_OBJECT_STORAGE_PREFIX",
        "LOG_ANALYSIS_QUEUE_MODE",
        "REDIS_URL",
        "LOG_ANALYSIS_QUEUE_PREFIX",
        "LOG_ANALYSIS_QUEUE_ATTEMPTS",
        "LOG_ANALYSIS_QUEUE_BACKOFF_MS",
        "LOG_ANALYSIS_QUEUE_CONCURRENCY"
      ])
    );
    expect(result.missingProxyTokens).toEqual(expect.arrayContaining(["reverse_proxy api:8787", "tls"]));
    expect(result.missingFiles).toEqual([
      "ops/self-hosted/storage/README.md",
      "ops/self-hosted/storage/provider-decision.md",
      "ops/self-hosted/storage/object-store.env.example"
    ]);
  });
});
