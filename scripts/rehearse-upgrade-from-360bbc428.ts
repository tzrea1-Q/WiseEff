import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { parse } from "dotenv";
import { buildGate0OwnedChildProcessEnv } from "./gate0-child-process-env";
import { gate0SecretValuesFromEnv, sanitizeGate0DiagnosticText, scanGate0ArtifactTree } from "./gate0-artifact-sanitizer";

const sourceSha = "360bbc428f5eb4d279b1ba1e130e687ef8ea78c6";
const origin = "http://127.0.0.1:18081";
const preservedTables = ["users", "projects", "user_password_credentials", "user_role_bindings", "organizations"];
type Observation = { count: number; digest: string };
type Snapshot = { preserved: Record<string, Observation>; current: { id: string; digest: string }; receipts: number; receiptsDigest: string; canonicalBindings: number; canonicalBindingsDigest: string; canonicalValues: Observation; legacySpecs: number; legacyBindings: number; migrations: number };
const statusFields = (text: string) => Object.fromEntries(text.split("\n").filter(line => /^[a-z_]+=/.test(line)).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
function assertPreserved(before: Snapshot, after: Snapshot) {
  for (const table of preservedTables) assert.deepEqual(after.preserved[table], before.preserved[table], `preservation failed: ${table}`);
  assert.deepEqual(after.current, before.current, "current seed Catalog changed");
  assert.equal(after.receipts, before.receipts);
  assert.equal(after.receiptsDigest, before.receiptsDigest);
  assert.equal(after.canonicalBindings, before.canonicalBindings);
  assert.equal(after.canonicalBindingsDigest, before.canonicalBindingsDigest);
  assert.deepEqual(after.canonicalValues, before.canonicalValues);
}
function assertCandidateGate(output: string) {
  assert.ok(!/"kind"\s*:\s*"absent"|"status"\s*:\s*"(?:blocked|error)"/.test(output), "candidate gate returned absent/blocked/error, not Catalog verification");
}
function replaceEnvValues(text: string, values: Record<string, string>) {
  const retained = text.split("\n").filter(line => !Object.hasOwn(values, line.match(/^\s*([A-Z_]+)=/)?.[1] ?? "")).join("\n").trimEnd();
  return `${retained}\n${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

async function main() {
  const repository = process.cwd();
  const targetSha = process.env.TARGET_SHA ?? "";
  const directory = mkdtempSync(path.join(tmpdir(), "wiseeff-upgrade-rehearsal-"));
  chmodSync(directory, 0o700);
  const evidenceDirectory = process.env.REHEARSAL_EVIDENCE_DIR ?? path.join(directory, "evidence");
  mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
  assert.equal(readdirSync(evidenceDirectory).length, 0, "evidence destination must be empty");
  const privateLogs = path.join(directory, "private-logs");
  mkdirSync(privateLogs, { mode: 0o700 });
  const checkout = path.join(directory, "deployment");
  const composeDirectory = path.join(checkout, "ops/self-hosted");
  const envFile = path.join(composeDirectory, ".env");
  const managerFile = path.join(composeDirectory, ".env.publication-manager");
  const ca = "/etc/ssl/certs/ca-certificates.crt";
  const project = `rehearsal-${randomBytes(8).toString("hex")}`;
  const runId = `${project}-upgrade`;
  const seedId = `${project}-seed`;
  const env = buildGate0OwnedChildProcessEnv({ COMPOSE_PROJECT_NAME: project, WISEEFF_APP_IMAGE: project, WISEEFF_APP_TAG: sourceSha,
    WISEEFF_ENV_FILE: envFile, COMPOSE_FILE: `${composeDirectory}/compose.yaml:${directory}/compose.override.yaml`,
    WISEEFF_OPERATION_LOCK_DIR: `${directory}/lock`, WISEEFF_UPGRADE_STATE_DIR: `${directory}/upgrade-state`,
    WISEEFF_UPGRADE_BACKUP_ROOT: `${directory}/backups`, WISEEFF_SEED_REBUILD_STATE_DIR: `${directory}/seed-state`,
    WISEEFF_SEED_REBUILD_BACKUP_ROOT: `${directory}/seed-backups`, WISEEFF_BUILD_CA_CERT_FILE: ca });
  const secrets = [...gate0SecretValuesFromEnv()];
  let phase = "input-validation";
  let commandIndex = 0;
  let deploymentCreated = false;
  let upgradeAttempted = false;
  let failedCommand: { name: string; exit: number | null; signal: string | null; code?: string } | undefined;
  const evidence: Record<string, unknown> = { sourceSha, targetSha, project, runId, synthetic: true, complete: false,
    journal: { available: false, reason: "upgrade-not-started" }, recoveryOutcome: { outcome: "upgrade-not-started", automaticRecovery: "not-run" } };
  const save = (name: string, value: unknown) => writeFileSync(path.join(privateLogs, name), typeof value === "string" ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
  function command(name: string, executable: string, args: string[], options: { cwd?: string; input?: string; allowFailure?: boolean } = {}) {
    console.log(`[rehearsal] ${phase}: ${name}`);
    const result = spawnSync(executable, args, { cwd: options.cwd ?? repository, env, input: options.input, encoding: "utf8", timeout: 25 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    save(`${String(++commandIndex).padStart(3, "0")}-${name}.log`, `exit=${result.status ?? "signal"}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    if (!options.allowFailure && result.status !== 0) failedCommand = { name, exit: result.status, signal: result.signal, code: (result.error as NodeJS.ErrnoException | undefined)?.code };
    if (!options.allowFailure) assert.equal(result.status, 0, `${name} failed (exit ${result.status ?? "signal"}); inspect sanitized evidence`);
    return { output: result.stdout ?? "", diagnostic: `${result.stdout ?? ""}\n${result.stderr ?? ""}`, status: result.status };
  }
  const compose = (name: string, args: string[], options: { input?: string; allowFailure?: boolean } = {}) => command(name, "bash", ["scripts/compose", "--env-file", envFile, ...args], { ...options, cwd: composeDirectory });
  const upgrade = (action: string, extra: string[] = [], allowFailure = false) => command(`upgrade-${action}`, "bash", ["scripts/upgrade.sh", action, ...extra, "--state-dir", `${directory}/upgrade-state`, "--backup-root", `${directory}/backups`], { cwd: composeDirectory, allowFailure });
  const seed = (action: string, extra: string[] = []) => command(`seed-${action}`, "bash", ["scripts/seed-rebuild.sh", action, "--run-id", seedId, ...extra], { cwd: composeDirectory });
  const sql = (name: string, text: string) => compose(name, ["exec", "-T", "postgres", "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "wiseeff", "-d", "wiseeff"], { input: text }).output.trim();
  const inApi = (name: string, code: string) => compose(name, ["exec", "-T", "api", "node", "--import", "tsx", "--input-type=module", "-e", code]).output.trim();
  function registerSecrets() {
    for (const file of [envFile, managerFile]) {
      if (!existsSync(file)) continue;
      for (const [key, value] of Object.entries(parse(readFileSync(file, "utf8")))) {
        if (value && /PASSWORD|SECRET|TOKEN|DATABASE_URL|API_KEY/.test(key)) {
          secrets.push(value);
          if (/DATABASE_URL/.test(key)) {
            try { secrets.push(decodeURIComponent(new URL(value).password)); } catch {}
          }
        }
      }
    }
  }
  async function ready() {
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        const response = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(2000) });
        const health = await response.json();
        if (response.status === 200 && health && typeof health === "object" && "ok" in health && health.ok === true) return;
      } catch {}
      await setTimeout(2000);
    }
    throw new Error("API readiness timed out");
  }
  async function login() {
    const values = parse(readFileSync(envFile, "utf8"));
    const response = await fetch(`${origin}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: values.WISEEFF_LAB_ADMIN_USERNAME, password: values.WISEEFF_LAB_ADMIN_PASSWORD }), signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    assert.ok(body && typeof body === "object" && "token" in body, "login response has no token");
    if (typeof body.token === "string") secrets.push(body.token);
    assert.equal(response.status, 200, "admin login failed");
    assert.ok(typeof body.token === "string" && body.token.length > 0);
    return body.token as string;
  }
  async function httpChecks(name: string, current: Snapshot["current"]) {
    await ready();
    const observations = [];
    for (const route of ["/health/live", "/health/ready", "/"]) {
      const response = await fetch(origin + route, { signal: AbortSignal.timeout(15_000) });
      const text = await response.text();
      observations.push({ route, status: response.status, ...(route === "/" ? { html: /<html/i.test(text) } : { body: JSON.parse(text) }) });
      save(`${name}-http.json`, observations);
      assert.equal(response.status, 200, route);
      if (route === "/") assert.match(text, /<html/i);
      else assert.equal(JSON.parse(text).ok, true, route);
    }
    const token = await login();
    for (const route of ["/api/v2/catalog/subjects", "/api/v2/catalog/definitions"]) {
      const response = await fetch(origin + route, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      const body = await response.json();
      assert.ok(body && typeof body === "object" && "items" in body && "catalogReleaseId" in body, "canonical response shape invalid");
      observations.push({ route, status: response.status, count: Array.isArray(body.items) ? body.items.length : 0, catalogReleaseId: body.catalogReleaseId });
      save(`${name}-http.json`, observations);
      assert.equal(response.status, 200, route);
      assert.ok(Array.isArray(body.items) && body.items.length > 0, "empty canonical Catalog read");
      assert.equal(body.catalogReleaseId, current.id);
    }
    const published = JSON.parse(inApi(`${name}-canonical-reader`, `import pg from 'pg';import{loadPublishedCatalog}from'./server/modules/parameter-bindings/catalogProjectValueSync.ts';const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});try{const catalog=await loadPublishedCatalog(pool);if(!catalog)throw new Error('published Catalog absent');console.log(JSON.stringify(catalog.release))}finally{await pool.end()}`));
    assert.equal(published.id, current.id);
    assert.equal(published.digest, current.digest);
    save(`${name}-canonical-reader.json`, published);
  }
  function observe(name: string): Snapshot {
    const rowDigest = `md5(coalesce(string_agg(to_jsonb(item)::text, E'\\n' order by to_jsonb(item)::text collate "C"), ''))`;
    const pairs = preservedTables.map(table => `'${table}', (select jsonb_build_object('count', count(*), 'digest', ${rowDigest}) from public.${table} item)`);
    const result: Snapshot = JSON.parse(sql(name, `begin isolation level repeatable read read only;
      select jsonb_build_object('preserved', jsonb_build_object(${pairs.join(",")}),
        'current', (select jsonb_build_object('id', release.id, 'digest', release.release_digest) from parameter_catalog.catalog_state state join parameter_catalog.catalog_releases release on release.id=state.current_catalog_release_id),
        'receipts', (select count(*) from parameter_catalog.catalog_activation_receipts),
        'receiptsDigest', (select ${rowDigest} from parameter_catalog.catalog_activation_receipts item),
        'canonicalBindings', (select count(*) from parameter_catalog.project_parameter_bindings),
        'canonicalBindingsDigest', (select ${rowDigest} from parameter_catalog.project_parameter_bindings item),
        'canonicalValues', (select jsonb_build_object('count', count(*), 'digest', ${rowDigest}) from parameter_catalog.project_parameter_values item),
        'legacySpecs', (select count(*) from public.parameter_specs), 'legacyBindings', (select count(*) from public.project_parameter_bindings),
        'migrations', (select count(*) from schema_migrations)); commit;`));
    save(`${name}.json`, result);
    return result;
  }
  function status() {
    const result = upgrade("status", ["--run-id", runId], true);
    const journal = statusFields(result.output);
    evidence.journal = { available: result.status === 0, ...journal };
    evidence.recoveryOutcome = result.status === 0 ? { outcome: journal.outcome, started: journal.recovery_started, verified: journal.recovery_verified, nextAction: journal.next_action, failure: journal.recovery_failure_summary } : { outcome: "no-upgrade-journal", automaticRecovery: "not-recorded" };
    return journal;
  }
  try {
    assert.match(targetSha, /^[a-f0-9]{40}$/, "TARGET_SHA must be an explicit full commit SHA (no default)");
    assert.notEqual(targetSha, sourceSha, "target must differ from source");
    assert.notEqual(process.getuid?.(), 0, "run as ordinary deployment user");
    phase = "architecture-preflight";
    const platform = command("docker-platform", "docker", ["info", "--format", "{{.OSType}}/{{.Architecture}}"] ).output.trim();
    assert.match(platform, /^linux\/(?:x86_64|amd64)$/, "requires a native Linux/AMD64 Docker daemon; never spoof the platform");
    evidence.platform = platform;
    phase = "deployment-checkout";
    command("target-available", "git", ["cat-file", "-e", `${targetSha}^{commit}`]);
    command("clone", "git", ["clone", "--no-local", "--quiet", repository, checkout]);
    deploymentCreated = true;
    command("source-checkout", "git", ["checkout", "--detach", sourceSha], { cwd: checkout });
    command("local-fetch-config", "git", ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], { cwd: checkout });
    command("local-target-fetch", "git", ["fetch", "origin", targetSha], { cwd: checkout });
    assert.equal(command("source-identity", "git", ["rev-parse", "HEAD"], { cwd: checkout }).output.trim(), sourceSha);
    assert.ok(existsSync(ca), "Ubuntu system CA bundle required");
    writeFileSync(path.join(directory, "compose.override.yaml"), `services:\n  proxy:\n    ports: !override ["127.0.0.1:18081:80"]\nsecrets:\n  wiseeff-corporate-ca:\n    file: ${ca}\n`, { mode: 0o600 });
    phase = "source-install";
    command("setup-init", "bash", ["scripts/setup.sh", "init", "--non-interactive", "--profile", "ip-lab", "--tls-mode", "http", "--ip", "127.0.0.1", "--seed", "chargelab", "--llm", "skip"], { cwd: composeDirectory });
    registerSecrets();
    writeFileSync(envFile, replaceEnvValues(readFileSync(envFile, "utf8"), { WISEEFF_APP_IMAGE: project, WISEEFF_APP_TAG: sourceSha,
      WISEEFF_PUBLIC_URL: origin, WISEEFF_API_BASE_URL: origin, VITE_WISEEFF_API_BASE_URL: origin,
      WISEEFF_BUILD_CA_CERT_FILE: ca, LOG_ANALYSIS_QUEUE_PREFIX: project }), { mode: 0o600 });
    command("bundled-base-image", "docker", ["load", "-i", path.join(composeDirectory, "images/node-22.21.1-alpine-amd64.tar")]);
    compose("source-build", ["build", "api"]);
    compose("data-start", ["up", "-d", "--no-build", "postgres", "redis", "minio", "minio-init"]);
    let postgresReady = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (compose("postgres-ready", ["exec", "-T", "postgres", "pg_isready", "-h", "127.0.0.1", "-U", "wiseeff", "-d", "wiseeff"], { allowFailure: true }).status === 0) {
        postgresReady = true;
        break;
      }
      await setTimeout(2000);
    }
    assert.ok(postgresReady, "PostgreSQL readiness timed out before migration");
    compose("source-migrate", ["run", "--rm", "--no-deps", "api", "npm", "run", "db:migrate"]);
    compose("source-start", ["up", "-d", "--no-build", "api", "worker", "web", "proxy"]);
    await ready();
    compose("source-provision", ["exec", "-T", "api", "npm", "run", "selfhost:ip-lab:provision"]);
    phase = "source-publication-bootstrap";
    const api = compose("api-container", ["ps", "-q", "api"]).output.trim();
    command("bootstrap-copy", "docker", ["cp", path.join(repository, "scripts/rehearse-upgrade-bootstrap.mjs"), `${api}:/app/scripts/rehearse-upgrade-bootstrap.mjs`]);
    const bootstrap = JSON.parse(compose("native-adoption-policy", ["exec", "-T", "api", "node", "--import", "tsx", "scripts/rehearse-upgrade-bootstrap.mjs"]).output.trim());
    env.WISEEFF_UPGRADE_ACTOR_PRINCIPAL_ID = bootstrap.actor;
    command("runtime-secrets-copy", "docker", ["cp", `${api}:/tmp/rehearsal-credentials`, `${directory}/credentials`]);
    const apiUrl = readFileSync(`${directory}/credentials/api.dsn`, "utf8").trim();
    const workerUrl = readFileSync(`${directory}/credentials/worker.dsn`, "utf8").trim();
    const managerUrl = readFileSync(`${directory}/credentials/manager.dsn`, "utf8").trim();
    assert.equal(new URL(apiUrl).username, "wiseeff_api");
    writeFileSync(envFile, replaceEnvValues(readFileSync(envFile, "utf8"), { DATABASE_URL: apiUrl, WISEEFF_WORKER_DATABASE_URL: workerUrl }), { mode: 0o600 });
    writeFileSync(managerFile, `WISEEFF_PUBLICATION_MANAGER=1\nWISEEFF_PUBLICATION_MANAGER_DATABASE_URL=${managerUrl}\nREDIS_URL=redis://redis:6379\nWISEEFF_UPGRADE_ACTOR_PRINCIPAL_ID=${bootstrap.actor}\n`, { mode: 0o600 });
    registerSecrets();
    compose("runtime-logins-start", ["up", "-d", "--force-recreate", "--no-build", "api", "worker", "publication-manager"]);
    await ready();
    phase = "native-seed-rebuild";
    seed("plan", ["--actor", bootstrap.actor, "--organization-id", "org-chargelab"]);
    const seedState = () => JSON.parse(readFileSync(`${directory}/seed-state/${seedId}/core-state.json`, "utf8"));
    seed("begin", ["--confirm-plan", seedState().plan.digest]);
    for (const stage of ["vendor", "configuration-schema"]) {
      seed("catalog-prepare", ["--stage", stage]);
      seed("catalog-publish", ["--stage", stage, "--actor", bootstrap.reviewer, "--confirm-artifact", seedState().publications[stage].artifactDigest]);
      seed("catalog-status", ["--stage", stage]);
    }
    seed("rebuild");
    seed("verify");
    seed("finish");
    seed("status");
    phase = "extra-project";
    await ready();
    const token = await login();
    const response = await fetch(`${origin}/api/v1/parameters/admin/projects`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ id: "rehearsal-preserved-project", name: "Preserved extra project", code: "RHR" }), signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 201, "extra project creation failed");
    phase = "source-state-verification";
    const source = observe("source-state");
    assert.match(source.current.id, /^crel_seed_/);
    assert.equal(source.receipts, 3);
    assert.equal(source.canonicalBindings, 372);
    assert.ok(source.legacySpecs > 0 && source.legacyBindings > 0);
    assert.equal(sql("extra-accounts-project", "select (select count(*) from user_password_credentials where username in ('rehearsal.reviewer','rehearsal.account'))=2 and exists(select 1 from projects where id='rehearsal-preserved-project');"), "t");
    const runtime = JSON.parse(inApi("runtime-login-boundary", `import pg from 'pg';const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});try{console.log(JSON.stringify((await pool.query('select current_user as login, rolsuper, rolinherit from pg_roles where rolname=current_user')).rows[0]))}finally{await pool.end()}`));
    assert.deepEqual(runtime, { login: "wiseeff_api", rolsuper: false, rolinherit: false });
    save("runtime-login-boundary.json", runtime);
    await httpChecks("before", source.current);
    const doctor = command("doctor-source", "bash", ["scripts/doctor.sh", "--env-file", envFile], { cwd: composeDirectory, allowFailure: true });
    evidence.sourceDoctorExit = doctor.status;
    const before = observe("before");
    phase = "upgrade-plan";
    upgradeAttempted = true;
    upgrade("plan", ["--ref", targetSha]);
    phase = "upgrade-apply";
    upgrade("apply", ["--ref", targetSha, "--run-id", runId, "--non-interactive", "--yes"]);
    env.WISEEFF_APP_TAG = targetSha;
    phase = "upgrade-status";
    const journal = status();
    assert.equal(journal.next_action, "none");
    assert.equal(journal.outcome, "completed");
    assert.equal(journal.target_sha, targetSha);
    assert.equal(journal.failure_code, "");
    assert.equal(command("target-checkout", "git", ["rev-parse", "HEAD"], { cwd: checkout }).output.trim(), targetSha);
    phase = "candidate-catalog-gate";
    const gate = compose("candidate-catalog-gate", ["exec", "-T", "api", "npm", "run", "parameter-definitions:check", "--", "--catalog-only"]);
    assertCandidateGate(gate.output);
    evidence.candidateCatalogGate = { exit: gate.status, absentReportRejected: true };
    phase = "preservation";
    assertPreserved(before, observe("after"));
    evidence.preservation = { tables: preservedTables, countsAndFullRowDigestsEqual: true };
    phase = "target-health";
    await httpChecks("after", before.current);
    for (const service of ["api", "worker", "web", "publication-manager"]) {
      const container = compose(`target-${service}`, ["ps", "-q", service]).output.trim();
      assert.ok(container);
      assert.equal(command(`target-${service}-image`, "docker", ["inspect", "--format", "{{.Config.Image}}", container]).output.trim(), `${project}:${targetSha}`);
    }
    phase = "normal-restart";
    const restartBaseline = observe("before-restart");
    compose("normal-restart", ["restart", "api", "worker", "publication-manager", "web", "proxy"]);
    await ready();
    assertPreserved(restartBaseline, observe("after-restart"));
    await httpChecks("restart", before.current);
    evidence.complete = true;
  } catch (error) {
    evidence.failedPhase = phase;
    evidence.failedCode = failedCommand?.exit ?? failedCommand?.code ?? "HARNESS_ASSERTION";
    evidence.failedCommand = failedCommand;
    evidence.failure = error instanceof Error ? error.message : "unknown failure";
    process.exitCode = 1;
  } finally {
    if (deploymentCreated) {
      registerSecrets();
      if (upgradeAttempted) status();
      else evidence.recoveryOutcome = { outcome: "upgrade-not-started", failedPhase: phase };
      command("seed-final-status", "bash", ["scripts/seed-rebuild.sh", "status", "--run-id", seedId], { cwd: composeDirectory, allowFailure: true });
      compose("final-services", ["ps", "-a"], { allowFailure: true });
      compose("final-service-logs", ["logs", "--no-color", "--tail", "150"], { allowFailure: true });
      if (upgradeAttempted && evidence.complete !== true) {
        try { observe("after-failure"); } catch { save("after-failure-unavailable.txt", "Database observation unavailable; see command log and journal.\n"); }
      }
      const cleanup = compose("cleanup-owned-stack", ["down", "--remove-orphans"], { allowFailure: true });
      evidence.cleanup = { exit: cleanup.status, volumesRemoved: false, scope: project };
      if (cleanup.status !== 0) {
        evidence.complete = false;
        process.exitCode = 1;
      }
    }
    save("summary.json", evidence);
    try {
      const staging = path.join(directory, "sanitized-evidence");
      mkdirSync(staging, { mode: 0o700 });
      for (const file of readdirSync(privateLogs)) {
        writeFileSync(path.join(staging, file), sanitizeGate0DiagnosticText(readFileSync(path.join(privateLogs, file), "utf8"), secrets).value, { mode: 0o600 });
      }
      const scan = await scanGate0ArtifactTree(staging, undefined, secrets);
      assert.equal(scan.violations.length, 0, "secret scan failed");
      for (const file of readdirSync(staging)) copyFileSync(path.join(staging, file), path.join(evidenceDirectory, file));
    } catch {
      evidence.complete = false;
      rmSync(evidenceDirectory, { recursive: true, force: true });
      mkdirSync(evidenceDirectory, { mode: 0o700 });
      writeFileSync(path.join(evidenceDirectory, "sanitization-failed.json"), JSON.stringify({ complete: false, reason: "Evidence withheld: sanitization or secret scan failed" }));
      process.exitCode = 1;
    }
    for (const entry of readdirSync(directory)) {
      const owned = path.join(directory, entry);
      if (owned !== evidenceDirectory) rmSync(owned, { recursive: true, force: true });
    }
    console.log(`[rehearsal] complete=${evidence.complete}; sanitized evidence: ${evidenceDirectory}`);
  }
}

if (process.argv.includes("--self-check")) {
  const configured = replaceEnvValues("# retained\nDATABASE_URL=bootstrap\nDATABASE_URL=stale\nPORT=8787\n", { DATABASE_URL: "runtime" });
  assert.equal(configured.split("\n").filter(line => line.startsWith("DATABASE_URL=")).length, 1);
  assert.equal(parse(configured).DATABASE_URL, "runtime");
  assert.ok(configured.includes("# retained\n") && configured.includes("PORT=8787\n"));
  assert.equal(statusFields("phase=completed\nnext_action=none\n").next_action, "none");
  const baseline = { preserved: Object.fromEntries(preservedTables.map(table => [table, { count: 2, digest: "baseline" }])), current: { id: "crel_seed_check", digest: "sha256:check" }, receipts: 3, receiptsDigest: "receipts", canonicalBindings: 372, canonicalBindingsDigest: "bindings", canonicalValues: { count: 372, digest: "values" }, legacySpecs: 1, legacyBindings: 1, migrations: 159 };
  assertPreserved(baseline, structuredClone(baseline));
  const changed = structuredClone(baseline);
  changed.preserved.users.digest = "changed";
  assert.throws(() => assertPreserved(baseline, changed), /preservation failed/);
  const changedBindings = structuredClone(baseline);
  changedBindings.canonicalBindingsDigest = "changed";
  assert.throws(() => assertPreserved(baseline, changedBindings));
  assert.throws(() => assertCandidateGate('{"status":"value","value":{"kind":"absent"}}'), /absent/);
  assertCandidateGate('{"status":"passed"}');
  const secret = "rehearsal-self-check-password";
  const sanitized = sanitizeGate0DiagnosticText(`DATABASE_URL=postgres://wiseeff_api:${secret}@postgres/wiseeff\nBearer rehearsal-self-check-token`, [secret, "rehearsal-self-check-token"]).value;
  assert.ok(!sanitized.includes(secret) && !sanitized.includes("rehearsal-self-check-token"));
  console.log("Upgrade rehearsal structural self-check passed; no Docker/runtime acceptance claimed.");
} else {
  await main();
}
