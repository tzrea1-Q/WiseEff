import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDeliveryImage,
  composeArgs,
  DELIVERY_PUBLISHER,
  preflightDeliveryLab,
  provisionDeliveryDatabase,
  rewriteDatabaseHost,
  writeDeliveryEnvFiles,
  type DeliveryLabEvidence,
} from "./catalog-publication-delivery-lab";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fail = (message: string, code = 2): never => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

if (process.env.WISEEFF_CATALOG_DELIVERY_ACCEPTANCE !== "1") {
  fail(
    "WISEEFF_CATALOG_DELIVERY_ACCEPTANCE=1 is required. Missing prerequisites are a failure, not a skip.",
  );
}

if (process.env.WISEEFF_CATALOG_TEST_CAPABILITIES) {
  fail(
    "WISEEFF_CATALOG_TEST_CAPABILITIES must be unset for delivery acceptance; grant real catalog capabilities instead.",
  );
}

const run = (command: string, args: string[], env: NodeJS.ProcessEnv) =>
  spawnSync(command, args, { encoding: "utf8", cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });

const waitHttp = async (url: string, attempts = 60): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 503) {
        if (url.endsWith("/health/live") && response.ok) return;
        if (!url.endsWith("/health/live") && response.status < 500) return;
        if (response.ok) return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  fail(`timed out waiting for ${url}`, 1);
};

const preflight = await preflightDeliveryLab(process.env);
if (process.env.WISEEFF_CATALOG_DELIVERY_PHASE === "precheck") {
  process.stdout.write(`${JSON.stringify({ ok: true, phase: "precheck", sha: preflight.sha })}\n`);
  process.exit(0);
}

const apiPort = process.env.WISEEFF_ISOLATED_API_PORT ?? "18787";
const webPort = process.env.WISEEFF_ISOLATED_WEB_PORT ?? "15173";
const publicPort = process.env.WISEEFF_ISOLATED_PUBLIC_PORT ?? "18080";
const apiOrigin = `http://127.0.0.1:${publicPort}`;
const frontendOrigin = `http://127.0.0.1:${publicPort}`;
const directApiOrigin = `http://127.0.0.1:${apiPort}`;
const composeProject = process.env.WISEEFF_DELIVERY_COMPOSE_PROJECT ?? "wiseeff-ra04";
const labDir = mkdtempSync(path.join(tmpdir(), "wiseeff-ra04-"));
const provisioned = await provisionDeliveryDatabase(preflight.bootstrapUrl);
const image = buildDeliveryImage(preflight.sha, apiOrigin, process.env);
const containerApiUrl = rewriteDatabaseHost(provisioned.apiUrl, "host.docker.internal");
const containerWorkerUrl = rewriteDatabaseHost(provisioned.workerUrl, "host.docker.internal");
const containerManagerUrl = rewriteDatabaseHost(provisioned.managerUrl, "host.docker.internal");
const envFiles = writeDeliveryEnvFiles({
  dir: labDir,
  apiUrl: containerApiUrl,
  workerUrl: containerWorkerUrl,
  managerUrl: containerManagerUrl,
  apiOrigin,
});
const [imageName, imageTag] = image.image.includes(":")
  ? (image.image.split(":") as [string, string])
  : [image.image, "local"];
const composeEnv: NodeJS.ProcessEnv = {
  ...process.env,
  WISEEFF_ENV_FILE: envFiles.publicEnv,
  WISEEFF_PUBLICATION_MANAGER_ENV_FILE: envFiles.managerEnv,
  WISEEFF_API_DATABASE_URL: containerApiUrl,
  WISEEFF_WORKER_DATABASE_URL: containerWorkerUrl,
  WISEEFF_APP_IMAGE: imageName,
  WISEEFF_APP_TAG: imageTag,
  WISEEFF_ISOLATED_API_PORT: apiPort,
  WISEEFF_ISOLATED_WEB_PORT: webPort,
  WISEEFF_ISOLATED_PUBLIC_PORT: publicPort,
  WISEEFF_CADDYFILE: "Caddyfile.ip-lab",
  VITE_WISEEFF_API_BASE_URL: apiOrigin,
};
const compose = composeArgs({
  project: composeProject,
  publicEnv: envFiles.publicEnv,
  managerEnv: envFiles.managerEnv,
});

const shutdown = (code: number) => {
  if (process.env.WISEEFF_DELIVERY_KEEP === "1" && code !== 0) {
    process.stderr.write(`keeping isolated stack ${composeProject}; labDir=${labDir}\n`);
    process.exit(code);
  }
  run("docker", [...compose, "down", "--remove-orphans"], composeEnv);
  void provisioned.drop();
  process.exit(code);
};

process.on("SIGINT", () => shutdown(1));
process.on("SIGTERM", () => shutdown(1));

const up = run(
  "docker",
  [...compose, "up", "-d", "--no-build", "redis", "minio", "minio-init", "api", "worker", "publication-manager", "web", "proxy"],
  composeEnv,
);
if (up.status !== 0) {
  process.stderr.write(up.stderr);
  process.stderr.write(up.stdout);
  shutdown(up.status ?? 1);
}

await waitHttp(`${directApiOrigin}/health/live`);
await waitHttp(`${apiOrigin}/health/live`);
await waitHttp(frontendOrigin);
const managerHealth = run(
  "docker",
  [...compose, "exec", "-T", "publication-manager", "curl", "-fsS", "http://127.0.0.1:8791/health/live"],
  composeEnv,
);
if (managerHealth.status !== 0) {
  process.stderr.write(managerHealth.stderr);
  process.stderr.write(managerHealth.stdout);
  fail("publication-manager /health/live failed after compose up", 1);
}

const loginFile = path.join(labDir, "login.json");
writeFileSync(
  loginFile,
  JSON.stringify({ username: DELIVERY_PUBLISHER.username, password: provisioned.publisherPassword }),
  { mode: 0o600 },
);
const evidence: DeliveryLabEvidence = {
  sha: preflight.sha,
  image: image.image,
  imageId: image.imageId,
  database: new URL(provisioned.databaseUrl).pathname.replace(/^\//, ""),
  apiRole: provisioned.apiRole,
  workerRole: provisioned.workerRole,
  managerRole: provisioned.managerRole,
  apiSuperuser: false,
  workerSuperuser: false,
  managerSuperuser: false,
  publisherUserId: DELIVERY_PUBLISHER.userId,
  organizationId: DELIVERY_PUBLISHER.organizationId,
  projectId: DELIVERY_PUBLISHER.projectId,
  adoptedReleaseId: provisioned.adoptedReleaseId,
  adoptedDigest: provisioned.adoptedDigest,
  adoptReceiptKind: provisioned.adoptReceiptKind,
  subjectId: provisioned.subjectId,
  apiOrigin,
  frontendOrigin,
  loginUsername: DELIVERY_PUBLISHER.username,
  composeProject,
};
const evidenceFile = path.join(labDir, "evidence.json");
writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
const restartCmd = path.join(labDir, "restart.sh");
writeFileSync(
  restartCmd,
  `#!/bin/sh
set -euo pipefail
docker ${compose.map((part) => JSON.stringify(part)).join(" ")} restart api worker publication-manager web proxy
`,
  { mode: 0o700 },
);

if (process.env.WISEEFF_CATALOG_DELIVERY_PHASE === "stack") {
  process.stdout.write(
    `${JSON.stringify({ ok: true, phase: "stack", evidence, labDir, loginFile, restartCmd }, null, 2)}\n`,
  );
  process.exit(0);
}

const playwrightEnv: NodeJS.ProcessEnv = {
  ...process.env,
  WISEEFF_CATALOG_DELIVERY_ACCEPTANCE: "1",
  WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true",
  WISEEFF_ACCEPTANCE_FRONTEND_URL: frontendOrigin,
  VITE_WISEEFF_API_BASE_URL: apiOrigin,
  WISEEFF_API_BASE_URL: apiOrigin,
  WISEEFF_CATALOG_DELIVERY_EVIDENCE: evidenceFile,
  WISEEFF_CATALOG_DELIVERY_LOGIN_FILE: loginFile,
  WISEEFF_CATALOG_DELIVERY_RESTART_CMD: restartCmd,
  WISEEFF_CATALOG_TEST_CAPABILITIES: "",
};
delete playwrightEnv.WISEEFF_CATALOG_TEST_CAPABILITIES;

const playwright = spawnSync(
  "npx",
  [
    "playwright",
    "test",
    "--config",
    "playwright.acceptance.config.ts",
    "e2e/acceptance/catalog-publication-delivery.acceptance.spec.ts",
  ],
  { stdio: "inherit", cwd: repoRoot, env: playwrightEnv },
);

process.stdout.write(`${JSON.stringify({ ok: playwright.status === 0, evidence }, null, 2)}\n`);
shutdown(playwright.status === 0 ? 0 : playwright.status ?? 1);
