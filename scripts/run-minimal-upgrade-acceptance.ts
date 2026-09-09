import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { gate0SecretValuesFromEnv, sanitizeGate0DiagnosticText } from "./gate0-artifact-sanitizer";

// Isolated terminal acceptance only. The application and upgrade controller are
// unmodified production entry points; this driver owns the synthetic deployment.
const sourceSha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
const repository = process.cwd();
const [candidateSha, expectedDaemon, ...extra] = process.argv.slice(2);
assert.match(candidateSha ?? "", /^[a-f0-9]{40}$/);
assert.ok(expectedDaemon && extra.length === 0, "candidate SHA and expected Docker daemon ID required");
assert.notEqual(process.getuid?.(), 0, "run as an ordinary deployment user");
const directory = mkdtempSync(path.join(tmpdir(), "wiseeff-minimal-terminal-"));
chmodSync(directory, 0o700);
let step = "preflight";
let commandNumber = 0;
const secrets = gate0SecretValuesFromEnv();
let lastCommandFailure = "";
function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? repository,
    env: options.env ?? process.env, input: options.input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    lastCommandFailure = sanitizeGate0DiagnosticText(result.stdout + result.stderr, secrets).value.slice(-6000);
    writeFileSync(path.join(directory, `private-failure-${++commandNumber}.log`), result.stdout + result.stderr, { mode: 0o600 });
    throw new Error(`minimal-terminal-${step}-command-failed:${result.status ?? "signal"}`);
  }
  return result.stdout.trim();
}
const docker = (...args: string[]) => run("docker", args);
assert.equal(docker("info", "--format", "{{.ID}}"), expectedDaemon);
assert.equal(docker("info", "--format", "{{.OSType}}/{{.Architecture}}"), "linux/x86_64",
  "the existing self-hosted base-image contract requires native amd64");
assert.equal(run("git", ["status", "--porcelain"]), "", "seal the candidate before terminal acceptance");
assert.equal(run("git", ["rev-parse", "HEAD"]), candidateSha);
const project = `minimal-${randomBytes(8).toString("hex")}`;
assert.equal(docker("ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`), "");
const checkout = path.join(directory, "deployment");
run("git", ["clone", "--no-local", "--quiet", repository, checkout]);
run("git", ["checkout", "--detach", sourceSha], { cwd: checkout });
const composeDir = path.join(checkout, "ops/self-hosted");
const password = randomBytes(24).toString("hex");
const account = { username: `minimal-${randomBytes(6).toString("hex")}`, password, name: "Synthetic upgrade admin", organization: "软件部" };
secrets.push(password, account.username);
const envFile = path.join(directory, "runtime.env");
const ca = path.join(directory, "corporate-ca.pem");
writeFileSync(ca, "", { mode: 0o600 });
const env = { ...process.env, COMPOSE_PROJECT_NAME: project, WISEEFF_ENV_FILE: envFile,
  COMPOSE_FILE: `${composeDir}/compose.yaml:${directory}/compose.override.yaml` };
writeFileSync(envFile, [
  "NODE_ENV=production", "HOST=0.0.0.0", "PORT=8787", "AUTH_MODE=production", "AUTH_PROVIDER=local",
  `POSTGRES_PASSWORD=${password}`, `DATABASE_URL=postgres://wiseeff:${password}@postgres:5432/wiseeff`,
  "MINIO_ROOT_USER=wiseeff", `MINIO_ROOT_PASSWORD=${password}`, "OBJECT_STORE_MODE=s3",
  "OBJECT_STORAGE_ENDPOINT=http://minio:9000", "OBJECT_STORAGE_BUCKET=wiseeff", "OBJECT_STORAGE_REGION=us-east-1",
  "OBJECT_STORAGE_ACCESS_KEY_ID=wiseeff", `OBJECT_STORAGE_SECRET_ACCESS_KEY=${password}`, "OBJECT_STORAGE_TLS_POLICY=required",
  "LOG_ANALYSIS_QUEUE_MODE=durable", "REDIS_URL=redis://redis:6379", `LOG_ANALYSIS_QUEUE_PREFIX=${project}`,
  "LOG_WORKER_ENABLED=false", "LOG_ANALYSIS_DETERMINISTIC=true", "XIAOZE_DETERMINISTIC=true", "XIAOZE_PROACTIVE_ENABLED=false",
  "DEBUG_DEVICE_GATEWAY_MODE=multi", "DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true",
  "LOG_WORKER_OBSERVABILITY_HOST=0.0.0.0", "WISEEFF_SITE_HOST=localhost", "WISEEFF_TLS_EMAIL=synthetic@example.invalid",
  "WISEEFF_API_BASE_URL=http://127.0.0.1:18080", "VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:18080",
  `WISEEFF_APP_IMAGE=${project}`, `WISEEFF_APP_TAG=${sourceSha}`, `WISEEFF_BUILD_CA_CERT_FILE=${ca}`,
  "WISEEFF_BUILD_TLS_POLICY=verify", "NOTIFICATION_EMAIL_MODE=disabled"
].join("\n") + "\n", { mode: 0o600 });
// Only test transport changes: retain stock services, volumes, commands and
// health checks, bind the proxy to loopback and suppress external certificate IO.
writeFileSync(path.join(directory, "Caddyfile"), ":80 {\n handle /api/* { reverse_proxy api:8787 }\n handle /health/* { reverse_proxy api:8787 }\n handle { reverse_proxy web:5173 }\n}\n", { mode: 0o600 });
writeFileSync(path.join(directory, "compose.override.yaml"), `services:
  proxy:
    ports: !override ["127.0.0.1:18080:80"]
    volumes:
      - ${directory}/Caddyfile:/etc/caddy/Caddyfile:ro
secrets:
  wiseeff-corporate-ca:
    file: ${ca}
`, { mode: 0o600 });
const compose = (...args: string[]) => run("bash", ["scripts/compose", "--env-file", envFile, ...args], { cwd: composeDir, env });
function owned(service: string) {
  const id = compose("ps", "-aq", service);
  assert.match(id, /^[a-f0-9]{64}$/);
  const inspected = JSON.parse(docker("inspect", id))[0];
  assert.equal(inspected.Config.Labels["com.docker.compose.project"], project);
  return id;
}
function inApi(script: string, input: unknown = {}) {
  return JSON.parse(run("docker", ["exec", "-i", owned("api"), "node", "--import", "tsx", "--input-type=module", "-e", script],
    { input: JSON.stringify(input) }));
}
const httpScript = `import{readFileSync}from'node:fs';const p=JSON.parse(readFileSync(0,'utf8'));const r=await fetch('http://127.0.0.1:8787'+p.route,{method:p.method,headers:{'content-type':'application/json',...(p.token?{authorization:'Bearer '+p.token}:{})},...(p.body===undefined?{}:{body:JSON.stringify(p.body)})});console.log(JSON.stringify({status:r.status,body:await r.json()}));`;
let token = "";
const http = (route: string, method = "GET", body?: unknown, status = 200) => {
  const result = inApi(httpScript, { route, method, body, token });
  assert.equal(result.status, status, `${step}: ${method} ${route}`);
  if (route === "/api/v1/auth/login" && typeof result.body.token === "string") secrets.push(result.body.token);
  return result.body;
};
let lastHealth: unknown;
async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const health = inApi(httpScript, { route: "/health/ready", method: "GET" });
      lastHealth = health;
      if (health.status === 200 && health.body.ok) return;
    } catch { /* startup remains unaccepted */ }
    await setTimeout(2000);
  }
  throw new Error("minimal-terminal-api-not-ready");
}
const evidence: Record<string, unknown> = { sourceSha, candidateSha, project, daemon: expectedDaemon, complete: false };
const record = () => writeFileSync(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
let created = false;
try {
  step = "old-image-build";
  docker("load", "-i", path.join(composeDir, "images/node-22.21.1-alpine-amd64.tar"));
  run("docker", ["build", "--secret", `id=wiseeff-corporate-ca,src=${ca}`, "--build-arg", "VITE_WISEEFF_RUNTIME_MODE=api",
    "--build-arg", "VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:18080", "--label", `org.opencontainers.image.revision=${sourceSha}`,
    "-t", `${project}:${sourceSha}`, "-f", "ops/self-hosted/Dockerfile", "."], { cwd: checkout });
  evidence.sourceImageId = JSON.parse(docker("image", "inspect", `${project}:${sourceSha}`))[0].Id;
  step = "old-start"; created = true;
  compose("up", "-d", "--no-build", "postgres", "redis", "minio", "minio-init", "api", "worker", "web", "proxy");
  await ready();
  step = "old-synthetic-business";
  inApi(`import{readFileSync}from'node:fs';import{createPostgresDatabase}from'./server/shared/database/client.ts';import{bootstrapLocalAdmin}from'./server/modules/auth/bootstrapLocalAdmin.ts';const db=createPostgresDatabase(process.env.DATABASE_URL);try{console.log(JSON.stringify(await bootstrapLocalAdmin(db,JSON.parse(readFileSync(0,'utf8')))))}finally{await db.close()}`, account);
  token = http("/api/v1/auth/login", "POST", { username: account.username, password }).token;
  const projectId = `${project}-business`;
  http("/api/v1/parameters/admin/projects", "POST", { id: projectId, name: "Preserved project", code: "MIN" }, 201);
  const node = http("/api/v1/debugging/admin/nodes", "POST", { name: "Preserved node", module: "minimal",
    bindings: [{ protocol: "hdc", nodePath: "/minimal/node", accessMode: "RW", enabled: true }] }, 201).item;
  const business = http("/api/v1/parameter-modules", "POST", { name: "Legacy business", kind: "business" }, 201).item;
  const driver = http("/api/v2/parameter-modules/driver-registry", "POST", { displayName: "Legacy driver", businessCategoryId: business.id, compatibles: ["wiseeff,minimal"] }, 201).item;
  const actualDriver = http("/api/v1/parameter-modules").items.find((item: { id: string }) => item.id === driver.id);
  http("/api/v2/parameter-specs", "POST", { attributionSubjectId: actualDriver.attributionSubjectId, propertyKey: "legacy-voltage",
    valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 }, constraints: { cells: 1 }, documentation: "Retained old parameter", reason: "synthetic source" }, 201);
  evidence.sourceBusiness = { projectId, nodeId: node.id, legacyParameterCreated: true };
  record();
  step = "candidate-checkout";
  run("git", ["checkout", "--detach", candidateSha], { cwd: checkout });
  const upgrade = (...args: string[]) => run("bash", ["scripts/upgrade.sh", ...args, "--env-file", envFile,
    "--state-dir", path.join(directory, "runs"), "--backup-root", path.join(directory, "backups")], { cwd: composeDir, env });
  step = "terminal-plan";
  evidence.plan = JSON.parse(upgrade("plan", "--ref", candidateSha, "--parameter-data-mode", "new-empty", "--json"));
  record();
  step = "terminal-apply";
  upgrade("apply", "--ref", candidateSha, "--parameter-data-mode", "new-empty", "--non-interactive", "--yes");
  step = "candidate-business";
  await ready();
  token = http("/api/v1/auth/login", "POST", { username: account.username, password }).token;
  assert.ok(http("/api/v1/debugging/admin/nodes").items.some((item: { id: string }) => item.id === node.id));
  assert.deepEqual(http("/api/v2/catalog"), { item: null, publicationState: "unpublished" });
  evidence.terminalUpgradeAndOriginalLogin = true;
  evidence.candidateImageId = JSON.parse(docker("inspect", owned("api")))[0].Image;
  // This first probe is deliberately not the final acceptance: value editing,
  // byte/record oracles and whole-state recovery must extend this same run.
  evidence.nextStage = "new-parameter-write-and-whole-state-recovery";
} catch (error) {
  evidence.failedStage = step;
  evidence.failure = error instanceof Error ? error.message : "minimal-terminal-failed";
  evidence.lastHealth = sanitizeGate0DiagnosticText(JSON.stringify(lastHealth ?? null), secrets).value;
  evidence.commandFailure = lastCommandFailure;
  if (created) {
    try { evidence.apiDiagnostics = sanitizeGate0DiagnosticText(compose("logs", "--no-color", "--tail", "40", "api"), secrets).value.slice(-6000); }
    catch { evidence.apiDiagnostics = "unavailable"; }
  }
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      const ids = docker("ps", "-aq", "--no-trunc", "--filter", `label=com.docker.compose.project=${project}`).split(/\s+/).filter(Boolean);
      for (const id of ids) {
        const labels = JSON.parse(docker("inspect", id))[0].Config.Labels;
        assert.equal(labels["com.docker.compose.project"], project);
        assert.equal(labels["com.docker.compose.project.working_dir"], composeDir);
      }
      compose("down", "--volumes", "--remove-orphans");
      evidence.cleanup = "complete";
    } catch { evidence.cleanup = "incomplete"; process.exitCode = 1; }
  }
  record();
  console.log(JSON.stringify({ evidence: path.join(directory, "evidence.json"), failedStage: evidence.failedStage ?? null, complete: false }));
}
