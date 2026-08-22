import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import pg from "pg";

import {
  OWNED_ACCEPTANCE_DATABASE_PREFIX,
  OWNED_ACCEPTANCE_DESCRIPTOR_ENV,
  OWNED_ACCEPTANCE_MARKER_PURPOSE,
  OWNED_ACCEPTANCE_MARKER_TABLE,
  OWNED_API_PORT_RANGE,
  OWNED_FRONTEND_PORT_RANGE,
  type OwnedLocalAcceptanceRuntimeDescriptorV1,
  assertOwnedRuntimeDescriptor,
  sha256,
  verifyOwnedRuntimeOwnership,
} from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV,
  initializeNestedRuntimeManifest,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";

type RuntimeEnv = Record<string, string | undefined>;

export type ProvisionOwnedRuntimeOptions = {
  baseDatabaseUrl: string;
  worktreeRoot?: string;
  runsRoot?: string;
};

export type OwnedLocalAcceptanceRuntime = {
  descriptorPath: string;
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1;
  env: RuntimeEnv;
  updatePhase(
    phase: "visual" | "browser",
    update: Partial<OwnedLocalAcceptanceRuntimeDescriptorV1["phases"]["visual"]>,
  ): void;
  finish(outcome: "success" | "failure"): Promise<void>;
};

type StartedProcess = {
  child: ChildProcess;
  command: string;
  log: string;
};

const defaultRunsRoot = "test-results/acceptance-runtime-runs";

export async function provisionOwnedLocalAcceptanceRuntime(
  options: ProvisionOwnedRuntimeOptions,
): Promise<OwnedLocalAcceptanceRuntime> {
  const worktreeRoot = realpathSync(options.worktreeRoot ?? process.cwd());
  const source = readCleanSource(worktreeRoot);
  const runId = buildRunId(source.commit);
  const runsRoot = path.resolve(worktreeRoot, options.runsRoot ?? defaultRunsRoot);
  assertPathWithinWorktree(worktreeRoot, runsRoot, "runtime runs root");
  ensureExistingAncestorsAreNotSymlinks(worktreeRoot, path.dirname(runsRoot));
  mkdirSync(runsRoot, { recursive: true });
  if (lstatSync(runsRoot).isSymbolicLink()) {
    throw new Error("Owned runtime runs root must not be a symbolic link.");
  }

  const runRoot = path.join(runsRoot, runId);
  if (existsSync(runRoot)) throw new Error(`Owned runtime run root already exists: ${runRoot}`);
  mkdirSync(runRoot);
  const objectRoot = path.join(runRoot, "object-store");
  if (existsSync(objectRoot)) throw new Error(`Owned runtime object root already exists: ${objectRoot}`);
  mkdirSync(objectRoot);
  if (lstatSync(objectRoot).isSymbolicLink()) {
    throw new Error("Owned runtime object root must not be a symbolic link.");
  }

  const descriptorPath = path.join(runRoot, "runtime.json");
  const apiLog = path.join(runRoot, "api.log");
  const frontendLog = path.join(runRoot, "frontend.log");
  const provisionLog = path.join(runRoot, "provision.log");
  const failureInventory = path.join(runRoot, "failure-inventory.json");
  const sourceWorktreeOutputManifest = path.join(runRoot, "source-worktree-output-manifest.json");
  const nestedRuntimeManifest = path.join(runRoot, "nested-runtime-manifest.json");
  const databaseName = buildDatabaseName(runId);
  const databaseUrl = databaseUrlFor(options.baseDatabaseUrl, databaseName);
  const adminUrl = databaseUrlFor(options.baseDatabaseUrl, "postgres");
  const authSecret = randomBytes(32).toString("hex");
  const authIssuer = `wiseeff-${runId}`;
  const objectMarker = path.join(objectRoot, ".wiseeff-acceptance-owner.json");
  const objectMarkerContent = `${JSON.stringify({
    kind: "wiseeff-owned-local-acceptance-object-store",
    purpose: OWNED_ACCEPTANCE_MARKER_PURPOSE,
    runId,
    sourceCommit: source.commit,
  }, null, 2)}\n`;
  writeFileSync(objectMarker, objectMarkerContent, { encoding: "utf8", flag: "wx" });
  initializeNestedRuntimeManifest(nestedRuntimeManifest, {
    parentRunId: runId,
    sourceCommit: source.commit,
  });

  const apiPort = await allocateAllowedLoopbackPort(OWNED_API_PORT_RANGE);
  const frontendPort = await allocateAllowedLoopbackPort(OWNED_FRONTEND_PORT_RANGE);
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const env = buildOwnedRuntimeEnv({
    databaseUrl,
    objectRoot,
    apiUrl,
    frontendUrl,
    apiPort,
    authIssuer,
    authSecret,
    descriptorPath,
    runId,
    sourceCommit: source.commit,
    runRoot,
    nestedRuntimeManifest,
  });
  const started: StartedProcess[] = [];
  let databaseCreated = false;

  try {
    await createCheckedAbsentDatabase(adminUrl, databaseName);
    databaseCreated = true;
    runNpmScriptWithLog(worktreeRoot, "db:migrate", env, provisionLog);
    runNpmScriptWithLog(worktreeRoot, "db:seed:all", env, provisionLog);
    const databaseEvidence = await writeAndReadDatabaseMarker(databaseUrl, {
      runId,
      sourceCommit: source.commit,
    });

    const api = spawnOwnedProcess({
      cwd: worktreeRoot,
      command: process.execPath,
      args: ["--import", "tsx", path.join(worktreeRoot, "server/index.ts")],
      env: { ...env, PORT: String(apiPort) },
      log: apiLog,
    });
    started.push(api);
    await waitForHttp(`${apiUrl}/health/live`, api.child, "API");

    const frontend = spawnOwnedProcess({
      cwd: worktreeRoot,
      command: process.execPath,
      args: [
        path.join(worktreeRoot, "node_modules/vite/bin/vite.js"),
        "--host",
        "127.0.0.1",
        "--port",
        String(frontendPort),
        "--strictPort",
      ],
      env,
      log: frontendLog,
    });
    started.push(frontend);
    await waitForHttp(frontendUrl, frontend.child, "frontend");

    const now = new Date().toISOString();
    const descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1 = {
      version: 1,
      kind: "wiseeff-owned-local-acceptance",
      run: {
        id: runId,
        sourceCommit: source.commit,
        worktreeRoot,
        sourceDirtyBefore: false,
        ownerPid: process.pid,
        createdAt: now,
        state: "ready",
      },
      database: {
        name: databaseName,
        connectionSha256: sha256(databaseUrl),
        absentBeforeCreate: true,
        marker: {
          table: OWNED_ACCEPTANCE_MARKER_TABLE,
          purpose: OWNED_ACCEPTANCE_MARKER_PURPOSE,
          runId,
          sourceCommit: source.commit,
        },
        migration: {
          command: "npm run db:migrate",
          appliedCount: databaseEvidence.appliedCount,
          latest: databaseEvidence.latestMigration,
          completedAt: databaseEvidence.completedAt,
        },
        seed: {
          command: "npm run db:seed:all",
          completedAt: databaseEvidence.completedAt,
          sentinels: databaseEvidence.sentinels,
        },
      },
      objectStore: {
        mode: "local",
        root: objectRoot,
        absentBeforeCreate: true,
        markerFile: objectMarker,
        markerSha256: sha256(objectMarkerContent),
      },
      endpoints: {
        api: {
          host: "127.0.0.1",
          port: apiPort,
          url: apiUrl,
          healthUrl: `${apiUrl}/health/live`,
        },
        frontend: {
          host: "127.0.0.1",
          port: frontendPort,
          url: frontendUrl,
        },
      },
      processes: {
        api: {
          pid: requirePid(api.child, "API"),
          startedAt: now,
          command: api.command,
          log: api.log,
        },
        frontend: {
          pid: requirePid(frontend.child, "frontend"),
          startedAt: now,
          command: frontend.command,
          log: frontend.log,
        },
      },
      auth: {
        mode: "production",
        provider: "hmac",
        issuer: authIssuer,
        secretSha256: sha256(authSecret),
        smokeSubject: "u-xu-yun",
      },
      runtime: {
        frontendMode: "api",
        xiaozeDeterministic: true,
        logAnalysisDeterministic: true,
        localWebhookAllowed: true,
        gatewayMode: "simulator",
        hdcAvailable: false,
      },
      phases: {
        visual: { status: "pending" },
        browser: { status: "pending" },
      },
      artifacts: {
        runRoot,
        descriptor: descriptorPath,
        failureInventory,
        sourceWorktreeOutputManifest,
        nestedRuntimeManifest,
        runtimeLogs: [apiLog, frontendLog],
      },
      cleanup: {
        policy: "success-only",
        status: "pending",
        exactDatabaseName: databaseName,
        exactObjectStoreRoot: objectRoot,
      },
    };
    assertOwnedRuntimeDescriptor(descriptor);
    writeDescriptor(descriptorPath, descriptor);
    await verifyOwnedRuntimeOwnership(descriptor, env);
    descriptor.run.state = "running";
    writeDescriptor(descriptorPath, descriptor);

    let finished = false;
    return {
      descriptorPath,
      descriptor,
      env,
      updatePhase(phase, update) {
        if (finished) throw new Error("Owned runtime is already finalized.");
        Object.assign(descriptor.phases[phase], update);
        writeDescriptor(descriptorPath, descriptor);
      },
      async finish(outcome) {
        if (finished) throw new Error("Owned runtime is already finalized.");
        finished = true;
        if (outcome === "failure") {
          await stopOwnedProcesses(started);
          descriptor.run.state = "failed-retained";
          descriptor.cleanup.status = "retained-on-failure";
          writeDescriptor(descriptorPath, descriptor);
          return;
        }

        try {
          await verifyOwnedRuntimeOwnership(descriptor, env);
          await stopOwnedProcesses(started);
          await verifyDatabaseCleanupMarker(databaseUrl, descriptor);
          verifyObjectRootForCleanup(descriptor);
          await dropExactDatabase(adminUrl, descriptor.database.name);
          rmSync(descriptor.objectStore.root, { recursive: true, force: false });
          await assertDatabaseAbsent(adminUrl, descriptor.database.name);
          if (existsSync(descriptor.objectStore.root)) {
            throw new Error("Owned runtime object root still exists after cleanup.");
          }
          descriptor.run.state = "cleaned";
          descriptor.cleanup.status = "complete";
          descriptor.cleanup.completedAt = new Date().toISOString();
          writeDescriptor(descriptorPath, descriptor);
        } catch (error) {
          await stopOwnedProcesses(started);
          descriptor.run.state = "cleanup-failed-retained";
          descriptor.cleanup.status = "retained-on-failure";
          writeDescriptor(descriptorPath, descriptor);
          throw error;
        }
      },
    };
  } catch (error) {
    await stopOwnedProcesses(started);
    writeProvisionFailure(runRoot, {
      runId,
      sourceCommit: source.commit,
      databaseName: databaseCreated ? databaseName : undefined,
      objectRoot,
      error,
    });
    throw error;
  }
}

function readCleanSource(worktreeRoot: string) {
  const commit = runGit(worktreeRoot, ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Owned runtime could not resolve exact source commit.");
  const status = runGit(worktreeRoot, ["status", "--porcelain", "--untracked-files=all"]);
  if (status) throw new Error("Owned runtime requires a clean source worktree before provisioning.");
  return { commit };
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function buildRunId(commit: string) {
  const timestamp = new Date().toISOString().replace(/[^0-9A-Za-z]/g, "");
  return `full-${timestamp}-${commit.slice(0, 12)}-${randomBytes(4).toString("hex")}`.toLowerCase();
}

function buildDatabaseName(runId: string) {
  const parts = runId.split("-");
  const timestamp = parts[1]?.replace(/[^a-z0-9]/g, "").slice(0, 17);
  const commit = parts[2]?.replace(/[^a-z0-9]/g, "").slice(0, 8);
  const nonce = parts[3]?.replace(/[^a-z0-9]/g, "").slice(0, 8);
  const suffix = [timestamp, commit, nonce].filter(Boolean).join("_");
  const databaseName = `${OWNED_ACCEPTANCE_DATABASE_PREFIX}${suffix}`;
  if (!/^wiseeff_acceptance_full_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Cannot build a safe owned runtime database name from ${runId}.`);
  }
  return databaseName;
}

function databaseUrlFor(baseUrl: string, databaseName: string) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createCheckedAbsentDatabase(adminUrl: string, databaseName: string) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const existing = await client.query("select 1 from pg_database where datname = $1", [databaseName]);
    if (existing.rows.length > 0) {
      throw new Error(`Owned runtime database must be absent before creation: ${databaseName}`);
    }
    await client.query(`create database ${quoteIdentifier(databaseName)}`);
  } finally {
    await client.end();
  }
}

async function writeAndReadDatabaseMarker(
  databaseUrl: string,
  identity: { runId: string; sourceCommit: string },
) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `create table ${OWNED_ACCEPTANCE_MARKER_TABLE} (
         purpose text primary key,
         run_id text not null,
         source_commit text not null,
         created_at timestamptz not null default now()
       )`,
    );
    await client.query(
      `insert into ${OWNED_ACCEPTANCE_MARKER_TABLE} (purpose, run_id, source_commit) values ($1, $2, $3)`,
      [OWNED_ACCEPTANCE_MARKER_PURPOSE, identity.runId, identity.sourceCommit],
    );
    const migrations = await client.query<{ name: string }>("select name from schema_migrations order by name");
    if (migrations.rows.length === 0) throw new Error("Owned runtime migration evidence is empty.");
    const sentinels: Record<string, number> = {};
    for (const table of ["organizations", "users", "projects", "log_records"]) {
      const result = await client.query<{ count: string }>(`select count(*)::text as count from ${table}`);
      sentinels[table] = Number(result.rows[0]?.count ?? 0);
      if (sentinels[table] <= 0) throw new Error(`Owned runtime seed sentinel ${table} is empty.`);
    }
    return {
      appliedCount: migrations.rows.length,
      latestMigration: migrations.rows.at(-1)!.name,
      completedAt: new Date().toISOString(),
      sentinels,
    };
  } finally {
    await client.end();
  }
}

function runNpmScriptWithLog(cwd: string, script: string, env: RuntimeEnv, logPath: string) {
  const fd = openSync(logPath, "a");
  try {
    const result = spawnSync("npm", ["run", script], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", fd, fd],
      shell: process.platform === "win32",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${script} failed with status ${result.status ?? "unknown"}; see ${logPath}.`);
  } finally {
    closeSync(fd);
  }
}

function spawnOwnedProcess(input: {
  cwd: string;
  command: string;
  args: string[];
  env: RuntimeEnv;
  log: string;
}): StartedProcess {
  const fd = openSync(input.log, "a");
  try {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      stdio: ["ignore", fd, fd],
      detached: process.platform !== "win32",
    });
    const command = [input.command, ...input.args].join(" ");
    return { child, command, log: input.log };
  } finally {
    closeSync(fd);
  }
}

async function waitForHttp(url: string, child: ChildProcess, label: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Owned ${label} process exited with ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The exact owned process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for owned ${label} runtime at ${url}.`);
}

async function stopOwnedProcesses(processes: StartedProcess[]) {
  for (const processRecord of [...processes].reverse()) {
    await stopOwnedProcess(processRecord.child);
  }
}

async function stopOwnedProcess(child: ChildProcess) {
  if (!child.pid || child.exitCode != null) return;
  const signal = (name: NodeJS.Signals) => {
    try {
      if (process.platform === "win32") child.kill(name);
      else process.kill(-child.pid!, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode == null) signal("SIGKILL");
}

async function allocateAllowedLoopbackPort(range: { min: number; max: number }) {
  for (let port = range.min; port <= range.max; port += 1) {
    const available = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`No owned loopback port is available in ${range.min}-${range.max}.`);
}

function buildOwnedRuntimeEnv(input: {
  databaseUrl: string;
  objectRoot: string;
  apiUrl: string;
  frontendUrl: string;
  apiPort: number;
  authIssuer: string;
  authSecret: string;
  descriptorPath: string;
  runId: string;
  sourceCommit: string;
  runRoot: string;
  nestedRuntimeManifest: string;
}): RuntimeEnv {
  const authorization = createOwnedAcceptanceAuthorization(input.authIssuer, input.authSecret);
  return {
    NODE_ENV: "development",
    DATABASE_URL: input.databaseUrl,
    TEST_DATABASE_URL: input.databaseUrl,
    HOST: "127.0.0.1",
    PORT: String(input.apiPort),
    AUTH_MODE: "production",
    AUTH_PROVIDER: "hmac",
    AUTH_TOKEN_ISSUER: input.authIssuer,
    AUTH_TOKEN_HMAC_SECRET: input.authSecret,
    M5_SMOKE_AUTHORIZATION: authorization,
    WISEEFF_SMOKE_AUTHORIZATION: authorization,
    VITE_WISEEFF_API_AUTHORIZATION: authorization,
    OBJECT_STORE_MODE: "local",
    OBJECT_STORE_ROOT: input.objectRoot,
    XIAOZE_DETERMINISTIC: "true",
    XIAOZE_PROACTIVE_ENABLED: "true",
    LOG_ANALYSIS_DETERMINISTIC: "true",
    LOG_WEBHOOK_ALLOW_INSECURE_LOCAL: "true",
    DEBUG_DEVICE_GATEWAY_MODE: "simulator",
    HDC_DEVICE_LAB_AVAILABLE: "false",
    DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true",
    VITE_WISEEFF_RUNTIME_MODE: "api",
    WISEEFF_API_BASE_URL: input.apiUrl,
    VITE_WISEEFF_API_BASE_URL: input.apiUrl,
    WISEEFF_ACCEPTANCE_FRONTEND_URL: input.frontendUrl,
    VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED: "true",
    VITE_XIAOZE_PROACTIVE_ENABLED: "true",
    M5_CONTRACT_CHECK_PASSED: "true",
    M5_SMOKE_ALLOW_NO_API: "false",
    WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true",
    WISEEFF_QUALITY_SKIP_SEED: "true",
    [OWNED_ACCEPTANCE_DESCRIPTOR_ENV]: input.descriptorPath,
    [OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV]: input.nestedRuntimeManifest,
    WISEEFF_ACCEPTANCE_EVIDENCE_ROOT: path.join(input.runRoot, "operation-evidence"),
    WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID: input.runId,
    WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT: input.sourceCommit,
    WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND: "full",
    WISEEFF_ACCEPTANCE_DEFER_LATEST_PUBLISH: "true",
  };
}

export function createOwnedAcceptanceAuthorization(issuer: string, secret: string) {
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      sub: "u-xu-yun",
      org: "org-chargelab",
      name: "Xu Yun",
      email: "xu@chargelab.cn",
      title: "Acceptance User",
      orgName: "ChargeLab",
      roles: [],
      permissions: [],
      isActive: true,
      nbf: 0,
      exp: 9_999_999_999,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

async function verifyDatabaseCleanupMarker(
  databaseUrl: string,
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1,
) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ database_name: string; run_id: string; source_commit: string; purpose: string }>(
      `select current_database() as database_name, run_id, source_commit, purpose
       from ${OWNED_ACCEPTANCE_MARKER_TABLE}
       where purpose = $1`,
      [OWNED_ACCEPTANCE_MARKER_PURPOSE],
    );
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      row?.database_name !== descriptor.database.name ||
      row.run_id !== descriptor.run.id ||
      row.source_commit !== descriptor.run.sourceCommit
    ) {
      throw new Error("Refusing cleanup: owned database marker mismatch.");
    }
  } finally {
    await client.end();
  }
}

function verifyObjectRootForCleanup(descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1) {
  if (descriptor.cleanup.exactObjectStoreRoot !== descriptor.objectStore.root) {
    throw new Error("Refusing cleanup: object root target mismatch.");
  }
  const stat = lstatSync(descriptor.objectStore.root);
  if (stat.isSymbolicLink()) throw new Error("Refusing cleanup: object root is a symbolic link.");
  const runRoot = realpathSync(descriptor.artifacts.runRoot);
  const objectRoot = realpathSync(descriptor.objectStore.root);
  assertPathWithinWorktree(runRoot, objectRoot, "object root cleanup target");
  const marker = lstatSync(descriptor.objectStore.markerFile);
  if (marker.isSymbolicLink()) throw new Error("Refusing cleanup: object marker is a symbolic link.");
  const markerContent = readFileSync(descriptor.objectStore.markerFile, "utf8");
  if (sha256(markerContent) !== descriptor.objectStore.markerSha256) {
    throw new Error("Refusing cleanup: object marker digest mismatch.");
  }
  const markerIdentity = JSON.parse(markerContent) as { runId?: string; sourceCommit?: string };
  if (
    markerIdentity.runId !== descriptor.run.id ||
    markerIdentity.sourceCommit !== descriptor.run.sourceCommit
  ) {
    throw new Error("Refusing cleanup: object marker run/source mismatch.");
  }
}

async function dropExactDatabase(adminUrl: string, databaseName: string) {
  if (!/^wiseeff_acceptance_full_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Refusing destructive cleanup for database ${databaseName}.`);
  }
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`drop database ${quoteIdentifier(databaseName)} with (force)`);
  } finally {
    await client.end();
  }
}

async function assertDatabaseAbsent(adminUrl: string, databaseName: string) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const result = await client.query("select 1 from pg_database where datname = $1", [databaseName]);
    if (result.rows.length > 0) throw new Error(`Owned runtime database still exists after cleanup: ${databaseName}`);
  } finally {
    await client.end();
  }
}

function writeDescriptor(descriptorPath: string, descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1) {
  assertOwnedRuntimeDescriptor(descriptor);
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
}

function writeProvisionFailure(
  runRoot: string,
  input: {
    runId: string;
    sourceCommit: string;
    databaseName?: string;
    objectRoot: string;
    error: unknown;
  },
) {
  writeFileSync(
    path.join(runRoot, "provision-failure.json"),
    `${JSON.stringify({
      kind: "wiseeff-owned-local-acceptance-provision-failure",
      runId: input.runId,
      sourceCommit: input.sourceCommit,
      retainedDatabaseName: input.databaseName,
      retainedObjectRoot: input.objectRoot,
      error: input.error instanceof Error ? input.error.message : String(input.error),
      recordedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function requirePid(child: ChildProcess, label: string) {
  if (!child.pid) throw new Error(`Owned ${label} process did not expose a PID.`);
  return child.pid;
}

function assertPathWithinWorktree(parent: string, child: string, label: string) {
  const relative = path.relative(parent, child);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Owned ${label} must be a strict descendant of ${parent}.`);
  }
}

function ensureExistingAncestorsAreNotSymlinks(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Owned runtime path escapes the source worktree.");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Owned runtime path contains symbolic link ${current}.`);
    }
  }
}
