import { describe, expect, it } from "vitest";
import { evaluateSelfHostedConfig } from "./check-self-hosted-config";

const validPackageJson = {
  scripts: {
    "backup:check": "tsx scripts/check-backup-drill.ts",
    "backup:drill": "tsx scripts/run-backup-drill.ts",
    "queue:check": "tsx scripts/check-durable-queue.ts",
    "restore:drill": "tsx scripts/run-restore-drill.ts",
    "selfhost:check": "tsx ops/self-hosted/scripts/check-self-hosted-config.ts",
    "selfhost:smoke": "tsx ops/self-hosted/scripts/run-self-hosted-smoke.ts",
    "selfhost:ip-lab:init": "tsx ops/self-hosted/scripts/init-ip-lab.ts",
    "selfhost:ip-lab:preflight": "tsx ops/self-hosted/scripts/preflight-ip-lab.ts",
    "selfhost:ip-lab:provision": "tsx ops/self-hosted/scripts/provision-ip-lab.ts",
    "selfhost:setup": "tsx ops/self-hosted/scripts/setup-selfhost.ts",
    "selfhost:doctor": "tsx ops/self-hosted/scripts/doctor-selfhost.ts",
    "selfhost:queue-maintenance": "tsx ops/self-hosted/scripts/queue-maintenance.ts",
    "dtc:check": "tsx scripts/check-dtc.ts",
    "dtc:seed:compile": "tsx scripts/compile-dts-seed.ts",
    "dts:toolchain:check": "tsx scripts/check-dts-toolchain.ts --required",
    "dts:config:validate": "tsx scripts/validate-dts-config-set.ts"
  }
};

const validCompose = `
version: "3.8"
x-wiseeff-image: &wiseeff-image
  "\${WISEEFF_APP_IMAGE:-wiseeff-app}:\${WISEEFF_APP_TAG:-local}"
x-wiseeff-runtime-proxy: &wiseeff-runtime-proxy
  HTTP_PROXY: \${WISEEFF_RUNTIME_HTTP_PROXY:-}
  HTTPS_PROXY: \${WISEEFF_RUNTIME_HTTPS_PROXY:-}
  NO_PROXY: \${WISEEFF_RUNTIME_NO_PROXY:-}
x-wiseeff-build: &wiseeff-build
  context: ../..
  dockerfile: ops/self-hosted/Dockerfile
  args:
    VITE_WISEEFF_RUNTIME_MODE: api
    VITE_WISEEFF_API_BASE_URL: \${VITE_WISEEFF_API_BASE_URL:?set VITE_WISEEFF_API_BASE_URL in ops/self-hosted/.env}
    HTTP_PROXY:
    HTTPS_PROXY:
    ALL_PROXY:
    NO_PROXY:
    http_proxy:
    https_proxy:
    all_proxy:
    no_proxy:
    WISEEFF_NPM_REGISTRY:
  secrets:
    - wiseeff-corporate-ca
services:
  postgres:
    image: postgres:16-alpine
    env_file: \${WISEEFF_ENV_FILE:-.env}
    volumes:
      - wiseeff-postgres-data:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - wiseeff-redis-data:/data
  api:
    image: *wiseeff-image
    build: *wiseeff-build
    env_file: \${WISEEFF_ENV_FILE:-.env}
    environment:
      <<: *wiseeff-runtime-proxy
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:8787/health/live"]
    command: ["sh", "-lc", "npx tsx server/index.ts"]
  worker:
    image: *wiseeff-image
    build: *wiseeff-build
    env_file: \${WISEEFF_ENV_FILE:-.env}
    environment:
      <<: *wiseeff-runtime-proxy
    command: ["sh", "-lc", "npm run worker:logs"]
    depends_on:
      redis:
        condition: service_healthy
  web:
    image: *wiseeff-image
    build: *wiseeff-build
    env_file: \${WISEEFF_ENV_FILE:-.env}
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:5173/"]
    command: ["sh", "-lc", "npm run preview -- --host 0.0.0.0 --port 5173 --strictPort"]
  proxy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./\${WISEEFF_CADDYFILE:-Caddyfile.example}:/etc/caddy/Caddyfile:ro
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://127.0.0.1:2019/config/"]
volumes:
  wiseeff-postgres-data:
secrets:
  wiseeff-corporate-ca:
    file: \${WISEEFF_BUILD_CA_CERT_FILE:-./build-network/empty-ca.pem}
`;

const validDockerfile = `
FROM node:22.21.1-alpine AS dtc-builder
ENV LD_LIBRARY_PATH=/opt/dtc/lib
RUN --mount=type=secret,id=wiseeff-corporate-ca cp /run/secrets/wiseeff-corporate-ca /etc/ssl/certs/wiseeff-corporate-ca.pem
ARG DTC_COMMIT=8f48565e5cfedc74d3f7512f1e0188e9d85dc1de
RUN apk add --no-cache build-base bison flex git pkgconf yaml-dev python3 py3-pip python3-dev swig meson samurai py3-meson-python
RUN pip3 wheel --no-build-isolation --wheel-dir /opt/dtc-wheels .
FROM node:22.21.1-alpine AS deps
ARG WISEEFF_NPM_REGISTRY
FROM node:22.21.1-alpine AS runtime
ENV LD_LIBRARY_PATH=/opt/dtc/lib
RUN apk add --no-cache curl python3 py3-pip yaml
ARG VITE_WISEEFF_RUNTIME_MODE=api
ARG VITE_WISEEFF_API_BASE_URL
ENV VITE_WISEEFF_RUNTIME_MODE=$VITE_WISEEFF_RUNTIME_MODE
ENV VITE_WISEEFF_API_BASE_URL=$VITE_WISEEFF_API_BASE_URL
COPY tools/dts-toolchain/requirements.txt /tmp/dts-toolchain-requirements.txt
COPY --from=dtc-builder /opt/dtc-wheels /tmp/dtc-wheels
RUN pip3 install --break-system-packages --no-cache-dir /tmp/dtc-wheels/libfdt-*.whl
RUN pip3 install --break-system-packages --no-cache-dir "ruamel.yaml>0.15.69" "jsonschema>=4.18" rfc3987
RUN pip3 install --break-system-packages --no-cache-dir --no-deps -r /tmp/dts-toolchain-requirements.txt
COPY --from=dtc-builder /opt/dtc /opt/dtc
RUN dtc --version && fdtoverlay --version && dt-validate --version
COPY ops/self-hosted/scripts/npm-ci-with-diagnostics.sh /usr/local/bin/wiseeff-npm-ci
RUN /usr/local/bin/wiseeff-npm-ci
RUN npx tsc -b && npx vite build
`;

const validDockerignore = `
node_modules/
dist/
.git/
**/.env
**/.env.*
ops/self-hosted/.state/
ops/self-hosted/.build-network.env
ops/self-hosted/images/*.tar
`;

const validBaseImageBundle = `
WISEEFF_BASE_IMAGE_REF=node:22.21.1-alpine
WISEEFF_BASE_IMAGE_ARCHIVE=node-22.21.1-alpine-amd64.tar
WISEEFF_BASE_IMAGE_ARCHIVE_REF=node:22.21.1-alpine-amd64
WISEEFF_BASE_IMAGE_PLATFORM=linux/amd64
WISEEFF_BASE_IMAGE_ID=sha256:eefb407f08684593068a61d76c3336fb418bdfd184357ccfe448aadfa1147b3e
WISEEFF_BASE_IMAGE_ARCHIVE_SHA256=42558e13bb39a42ac540780d4231c62a945bcaa48250bd7ac01b2af72c8f91f0
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
XIAOZE_LLM_API_BASE_URL=
XIAOZE_LLM_MODEL=
XIAOZE_LLM_API_KEY=
AGENT_API_TIMEOUT_MS=30000
XIAOZE_CHECKPOINTER=postgres
LOG_ANALYSIS_API_BASE_URL=
LOG_ANALYSIS_MODEL=
LOG_ANALYSIS_API_KEY=
LOG_ANALYSIS_API_TIMEOUT_MS=30000
LOG_ANALYSIS_TOKEN_BUDGET=8000
LOG_ANALYSIS_DETERMINISTIC=false
LOG_WORKER_ENABLED=false
LOG_ANALYSIS_QUEUE_MODE=durable
REDIS_URL=redis://redis:6379
LOG_ANALYSIS_QUEUE_PREFIX=wiseeff
LOG_ANALYSIS_QUEUE_ATTEMPTS=4
LOG_ANALYSIS_QUEUE_BACKOFF_MS=1000
LOG_ANALYSIS_QUEUE_CONCURRENCY=1
M5_BACKUP_RESTORE_DRILL_AT=
`;

const logAnalysisLlmEnvKeys = [
  "LOG_ANALYSIS_API_BASE_URL",
  "LOG_ANALYSIS_MODEL",
  "LOG_ANALYSIS_API_KEY",
  "LOG_ANALYSIS_API_TIMEOUT_MS",
  "LOG_ANALYSIS_TOKEN_BUDGET",
  "LOG_ANALYSIS_DETERMINISTIC"
] as const;

const existingSelfHostedFiles = new Set([
  "ops/self-hosted/storage/README.md",
  "ops/self-hosted/storage/provider-decision.md",
  "ops/self-hosted/storage/object-store.env.example",
  "ops/self-hosted/scripts/compose",
  "ops/self-hosted/scripts/operation-lock.sh",
  "ops/self-hosted/scripts/upgrade.sh",
  "ops/self-hosted/scripts/upgrade-lib.sh",
  "ops/self-hosted/scripts/npm-ci-with-diagnostics.sh",
  "ops/self-hosted/scripts/build-network.sh",
  "ops/self-hosted/scripts/build-network-lib.sh",
  "ops/self-hosted/.build-network.env.example",
  "ops/self-hosted/build-network/empty-ca.pem",
  "ops/self-hosted/upgrade-protocol.env",
  "ops/self-hosted/images/base-image-bundle.env",
  "ops/self-hosted/images/node-22.21.1-alpine-amd64.tar",
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
]);

function evaluateWithEnvExample(envExampleText: string) {
  return evaluateSelfHostedConfig({
    packageJson: validPackageJson,
    composeText: validCompose,
    dockerfileText: validDockerfile,
    dockerignoreText: validDockerignore,
    baseImageBundleText: validBaseImageBundle,
    envExampleText,
    caddyfileText: validCaddyfile,
    existingFiles: existingSelfHostedFiles
  });
}

function omitEnvKeys(text: string, keys: readonly string[]) {
  const drop = new Set(keys);
  return text
    .split("\n")
    .filter((line) => {
      const key = line.trim().split("=")[0];
      return !drop.has(key);
    })
    .join("\n");
}

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
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result).toEqual({
      status: "passed",
      missingScripts: [],
      missingServices: [],
      missingComposeTokens: [],
      missingDockerfileTokens: [],
      dockerfileSafetyIssues: [],
      missingDockerignoreTokens: [],
      baseImageBundleIssues: [],
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
      baseImageBundleText: "",
      envExampleText: "NODE_ENV=production\n",
      caddyfileText: "",
      existingFiles: new Set()
    });

    expect(result.status).toBe("failed");
    expect(result.missingScripts).toEqual([
      "selfhost:check",
      "selfhost:smoke",
      "selfhost:ip-lab:init",
      "selfhost:ip-lab:preflight",
      "selfhost:ip-lab:provision",
      "selfhost:setup",
      "selfhost:doctor",
      "selfhost:queue-maintenance",
      "backup:drill",
      "restore:drill",
      "backup:check",
      "queue:check",
      "dtc:check",
      "dtc:seed:compile",
      "dts:toolchain:check",
      "dts:config:validate"
    ]);
    expect(result.missingServices).toEqual(["postgres", "redis", "worker", "web", "proxy"]);
    expect(result.missingComposeTokens).toEqual(
      expect.arrayContaining([
        "wiseeff-postgres-data:/var/lib/postgresql/data",
        "wiseeff-redis-data:/data",
        "env_file: ${WISEEFF_ENV_FILE:-.env}",
        "redis-server",
        "npm run worker:logs",
        "VITE_WISEEFF_API_BASE_URL: ${VITE_WISEEFF_API_BASE_URL:?set VITE_WISEEFF_API_BASE_URL in ops/self-hosted/.env}"
      ])
    );
    expect(result.missingDockerfileTokens).toEqual(expect.arrayContaining(["ARG VITE_WISEEFF_API_BASE_URL"]));
    expect(result.missingDockerfileTokens).toEqual(
      expect.arrayContaining(["ARG DTC_COMMIT=8f48565e5cfedc74d3f7512f1e0188e9d85dc1de"])
    );
    expect(result.missingDockerignoreTokens).toEqual(
      expect.arrayContaining(["**/.env", "**/.env.*", "ops/self-hosted/images/*.tar"])
    );
    expect(result.baseImageBundleIssues).toEqual(
      expect.arrayContaining(["missing-key:WISEEFF_BASE_IMAGE_REF", "missing-key:WISEEFF_BASE_IMAGE_ARCHIVE_SHA256"])
    );
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
        "XIAOZE_LLM_API_BASE_URL",
        "XIAOZE_LLM_MODEL",
        "XIAOZE_LLM_API_KEY",
        "AGENT_API_TIMEOUT_MS",
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
        "LOG_ANALYSIS_QUEUE_CONCURRENCY",
        "LOG_ANALYSIS_API_BASE_URL",
        "LOG_ANALYSIS_MODEL",
        "LOG_ANALYSIS_API_KEY",
        "LOG_ANALYSIS_API_TIMEOUT_MS",
        "LOG_ANALYSIS_TOKEN_BUDGET",
        "LOG_ANALYSIS_DETERMINISTIC"
      ])
    );
    expect(result.missingProxyTokens).toEqual(expect.arrayContaining(["reverse_proxy api:8787", "tls"]));
    expect(result.missingFiles).toEqual(
      expect.arrayContaining([
        "ops/self-hosted/storage/README.md",
        "ops/self-hosted/storage/provider-decision.md",
        "ops/self-hosted/storage/object-store.env.example",
        "ops/self-hosted/scripts/compose",
        "ops/self-hosted/Caddyfile.ip-lab",
        "ops/self-hosted/scripts/deploy-ip-lab.sh"
      ])
    );
  });

  it("rejects self-hosted Node images below the Pi Agent provider runtime floor", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose,
      dockerfileText: validDockerfile.replaceAll("node:22.21.1-alpine", "node:22.18.0-alpine"),
      dockerignoreText: validDockerignore,
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.missingDockerfileTokens).toContain("FROM node:>=22.19.0");
    expect(result.baseImageBundleIssues).toContain("dockerfile-ref-mismatch");
  });

  it("rejects drift between the bundled archive and its pinned checksum", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose,
      dockerfileText: validDockerfile,
      dockerignoreText: validDockerignore,
      baseImageBundleText: validBaseImageBundle,
      baseImageArchiveSha256: "a".repeat(64),
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.baseImageBundleIssues).toContain("archive-checksum-mismatch");
  });

  it("requires Compose to carry the deployment proxy into BuildKit without Dockerfile proxy ENV values", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose
        .replace("    HTTP_PROXY:\n", "")
        .replace("    HTTPS_PROXY:\n", "")
        .replace("    ALL_PROXY:\n", "")
        .replace("    NO_PROXY:\n", ""),
      dockerfileText: validDockerfile,
      dockerignoreText: validDockerignore,
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.missingComposeTokens).toEqual(
      expect.arrayContaining(["HTTP_PROXY:", "HTTPS_PROXY:", "NO_PROXY:", "ALL_PROXY:"])
    );
  });

  it("requires the approved corporate CA to enter each networked build stage through a BuildKit secret", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose.replaceAll("wiseeff-corporate-ca", "missing-corporate-ca"),
      dockerfileText: validDockerfile.replaceAll("wiseeff-corporate-ca", "missing-corporate-ca"),
      dockerignoreText: validDockerignore,
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.missingComposeTokens).toContain("wiseeff-corporate-ca");
    expect(result.missingDockerfileTokens).toContain("--mount=type=secret,id=wiseeff-corporate-ca");
  });

  it("rejects an external Dockerfile frontend that would add an unproxied metadata dependency", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose,
      dockerfileText: `# syntax=docker/dockerfile:1.7\n${validDockerfile}`,
      dockerignoreText: validDockerignore,
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.dockerfileSafetyIssues).toContain("external-syntax-frontend");
  });

  it("carries the optional npm registry into the diagnostic install wrapper", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose.replace("    WISEEFF_NPM_REGISTRY:\n", ""),
      dockerfileText: validDockerfile.replace("ARG WISEEFF_NPM_REGISTRY\n", ""),
      dockerignoreText: validDockerignore,
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.missingComposeTokens).toContain("WISEEFF_NPM_REGISTRY:");
    expect(result.missingDockerfileTokens).toContain("ARG WISEEFF_NPM_REGISTRY");
  });

  it("keeps the pinned DTC builder dependencies required by the Alpine source build", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose,
      dockerfileText: validDockerfile.replace(
        "build-base bison flex git pkgconf yaml-dev",
        "build-base bison flex git"
      ),
      dockerignoreText: validDockerignore,
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.missingDockerfileTokens).toContain(
      "apk add --no-cache build-base bison flex git pkgconf yaml-dev"
    );
  });

  it("keeps the DTC shared-library path in both the builder and runtime stages", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose,
      dockerfileText: validDockerfile.replace("ENV LD_LIBRARY_PATH=/opt/dtc/lib\n", ""),
      dockerignoreText: validDockerignore,
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.missingDockerfileTokens).toContain(
      "ENV LD_LIBRARY_PATH=/opt/dtc/lib (dtc-builder and runtime)"
    );
  });

  it("uses the pinned DTC source for the Python libfdt binding instead of the legacy PyPI package", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose,
      dockerfileText: validDockerfile
        .replace("RUN pip3 wheel --no-build-isolation --wheel-dir /opt/dtc-wheels .\n", "")
        .replace("COPY --from=dtc-builder /opt/dtc-wheels /tmp/dtc-wheels\n", "")
        .replace("RUN pip3 install --break-system-packages --no-cache-dir /tmp/dtc-wheels/libfdt-*.whl\n", "")
        .replace(
          "RUN pip3 install --break-system-packages --no-cache-dir --no-deps -r /tmp/dts-toolchain-requirements.txt\n",
          ""
        ),
      dockerignoreText: validDockerignore,
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.missingDockerfileTokens).toEqual(
      expect.arrayContaining([
        "pip3 wheel --no-build-isolation --wheel-dir /opt/dtc-wheels .",
        "COPY --from=dtc-builder /opt/dtc-wheels /tmp/dtc-wheels",
        "pip3 install --break-system-packages --no-cache-dir /tmp/dtc-wheels/libfdt-*.whl",
        "pip3 install --break-system-packages --no-cache-dir --no-deps -r /tmp/dts-toolchain-requirements.txt"
      ])
    );
  });

  it("keeps the runtime libyaml dependency required by the pinned DTC binary", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose,
      dockerfileText: validDockerfile.replace(
        "RUN apk add --no-cache curl python3 py3-pip yaml\n",
        "RUN apk add --no-cache curl python3 py3-pip\n"
      ),
      dockerignoreText: validDockerignore,
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.missingDockerfileTokens).toContain("apk add --no-cache curl python3 py3-pip yaml");
  });

  it("keeps runtime proxying opt-in and limited to application containers", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose
        .replaceAll("WISEEFF_RUNTIME_HTTP_PROXY", "MISSING_RUNTIME_HTTP_PROXY")
        .replaceAll("WISEEFF_RUNTIME_NO_PROXY", "MISSING_RUNTIME_NO_PROXY"),
      dockerfileText: validDockerfile,
      dockerignoreText: validDockerignore,
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.missingComposeTokens).toEqual(
      expect.arrayContaining(["WISEEFF_RUNTIME_HTTP_PROXY", "WISEEFF_RUNTIME_NO_PROXY"])
    );
  });

  it("keeps the private build-network file out of the Docker context", () => {
    const result = evaluateSelfHostedConfig({
      packageJson: validPackageJson,
      composeText: validCompose,
      dockerfileText: validDockerfile,
      dockerignoreText: validDockerignore.replace("ops/self-hosted/.build-network.env\n", ""),
      baseImageBundleText: validBaseImageBundle,
      envExampleText: validEnvExample,
      caddyfileText: validCaddyfile,
      existingFiles: existingSelfHostedFiles
    });

    expect(result.status).toBe("failed");
    expect(result.missingDockerignoreTokens).toContain("ops/self-hosted/.build-network.env");
  });

  it("requires the log-analysis LLM env family to be declared even when values are blank", () => {
    const result = evaluateWithEnvExample(omitEnvKeys(validEnvExample, logAnalysisLlmEnvKeys));

    expect(result.status).toBe("failed");
    expect(result.missingEnvKeys).toEqual([...logAnalysisLlmEnvKeys]);
  });
});
