import { execFile, spawn, type ChildProcess } from "node:child_process";
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
import { promisify } from "node:util";

import {
  OWNED_ACCEPTANCE_DATABASE_PREFIX,
  OWNED_ACCEPTANCE_DESCRIPTOR_ENV,
  OWNED_ACCEPTANCE_MARKER_PURPOSE,
  OWNED_ACCEPTANCE_MARKER_TABLE,
  OWNED_API_PORT_RANGE,
  OWNED_FRONTEND_PORT_RANGE,
  type OwnedLocalAcceptanceRuntimeDescriptorV1,
  assertOwnedRuntimeDescriptor,
  buildOwnedRuntimeArtifactEnv,
  databaseIdentityFromUrl,
  sha256,
  verifyOwnedRuntimeOwnership,
} from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV,
  initializeNestedRuntimeManifest,
  readNestedRuntimeManifest,
  recordNestedRuntimeFinish,
  type NestedRuntimeCleanup,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";
import {
  isGate0SecretEnvKey,
  sanitizeGate0DiagnosticText,
} from "./gate0-artifact-sanitizer";
import {
  stopOwnedProcessGroup,
  waitForOwnedProcessGroupExit,
  type StopOwnedProcessGroupOptions,
} from "./owned-process-group";
import {
  withOwnerAwarePostgres,
  type OwnerAwarePostgresDeadline,
} from "./owner-aware-postgres";

type RuntimeEnv = Record<string, string | undefined>;

export type ProvisionOwnedRuntimeOptions = {
  baseDatabaseUrl: string;
  worktreeRoot?: string;
  runsRoot?: string;
  ownerDeadline?: {
    signal: AbortSignal;
    deadlineAt: number;
    remainingMs(stage: string): number;
  };
};

export type OwnedLocalAcceptanceRuntime = {
  descriptorPath: string;
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1;
  env: RuntimeEnv;
  updatePhase(
    phase: "visual" | "browser",
    update: Partial<OwnedLocalAcceptanceRuntimeDescriptorV1["phases"]["visual"]>,
  ): void;
  finish(
    outcome: "success" | "failure",
    finalizeArtifacts?: () => Promise<void>,
    cleanupOwnerDeadline?: ProvisionOwnedRuntimeOptions["ownerDeadline"],
  ): Promise<void>;
};

type StartedProcess = {
  child: ChildProcess;
  command: string;
  log: string;
};

export type OrphanedOwnedRuntimeCleanupInput = {
  baseDatabaseUrl: string;
  worktreeRoot: string;
  runRoot: string;
  databaseName: string;
  runId: string;
  sourceCommit: string;
  ports: number[];
  ownerDeadline?: OwnerAwarePostgresDeadline;
};

const defaultRunsRoot = "test-results/acceptance-runtime-runs";
const execFileAsync = promisify(execFile);

export async function provisionOwnedLocalAcceptanceRuntime(
  options: ProvisionOwnedRuntimeOptions,
): Promise<OwnedLocalAcceptanceRuntime> {
  const worktreeRoot = realpathSync(options.worktreeRoot ?? process.cwd());
  checkpointOwner(options, "source inspection");
  const source = await readCleanSource(worktreeRoot, options.ownerDeadline?.signal);
  checkpointOwner(options, "runtime root creation");
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

  const apiPort = await allocateAllowedLoopbackPort(OWNED_API_PORT_RANGE, options.ownerDeadline);
  const frontendPort = await allocateAllowedLoopbackPort(OWNED_FRONTEND_PORT_RANGE, options.ownerDeadline);
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
    checkpointOwner(options, "database creation");
    await createCheckedAbsentDatabase(adminUrl, databaseName, options.ownerDeadline);
    databaseCreated = true;
    await runNpmScriptWithLog(worktreeRoot, "db:migrate", env, provisionLog, options.ownerDeadline);
    await runNpmScriptWithLog(worktreeRoot, "db:seed:all", env, provisionLog, options.ownerDeadline);
    checkpointOwner(options, "database marker proof");
    const databaseEvidence = await writeAndReadDatabaseMarker(databaseUrl, {
      runId,
      sourceCommit: source.commit,
    }, options.ownerDeadline);

    const api = spawnOwnedProcess({
      cwd: worktreeRoot,
      command: process.execPath,
      args: ["--import", "tsx", path.join(worktreeRoot, "server/index.ts")],
      env: { ...env, PORT: String(apiPort) },
      log: apiLog,
    });
    started.push(api);
    await waitForHttp(`${apiUrl}/health/live`, api.child, "API", options.ownerDeadline);

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
    await waitForHttp(frontendUrl, frontend.child, "frontend", options.ownerDeadline);

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
        connection: databaseIdentityFromUrl(databaseUrl),
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
        resources: {
          apiProcess: { status: "pending" },
          frontendProcess: { status: "pending" },
          database: { status: "pending" },
          objectStore: { status: "pending" },
          descriptor: { status: "pending" },
          artifacts: { status: "pending" },
        },
      },
    };
    assertOwnedRuntimeDescriptor(descriptor);
    writeDescriptor(descriptorPath, descriptor);
    await verifyOwnedRuntimeOwnership(descriptor, env, options.ownerDeadline);
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
      async finish(outcome, finalizeArtifacts, cleanupOwnerDeadline = options.ownerDeadline) {
        if (finished) throw new Error("Owned runtime is already finalized.");
        finished = true;
        if (outcome === "failure") {
          const cleanupErrors: Error[] = [];
          await finalizeRunningNestedRuntimesAfterFailure(
            descriptor.artifacts.nestedRuntimeManifest,
            "Gate0 failure policy retains nested forensic resources.",
          ).catch((error) => cleanupErrors.push(asError(error)));
          await stopAndRecordOwnedProcesses(started, descriptor).catch((error) => cleanupErrors.push(asError(error)));
          setRetainedResources(descriptor, "Gate0 failure policy retains forensic resources.");
          await finalizeArtifacts?.().then(
            () => { descriptor.cleanup.resources.artifacts = { status: "verified" }; },
            (error) => {
              descriptor.cleanup.resources.artifacts = { status: "failed", reason: safeCleanupReason(error) };
              cleanupErrors.push(asError(error));
            },
          );
          descriptor.cleanup.resources.descriptor = { status: "retained", reason: "Forensic descriptor retained." };
          descriptor.run.state = cleanupErrors.length > 0 ? "cleanup-failed-retained" : "failed-retained";
          descriptor.cleanup.status = "retained-on-failure";
          writeDescriptor(descriptorPath, descriptor);
          if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Gate0 failure finalization did not complete cleanly.");
          return;
        }

        try {
          assertNestedRuntimesCleanedForSuccess(descriptor.artifacts.nestedRuntimeManifest);
          await verifyOwnedRuntimeOwnership(descriptor, env, cleanupOwnerDeadline);
          await stopAndRecordOwnedProcesses(started, descriptor);
          await finalizeArtifacts?.();
          descriptor.cleanup.resources.artifacts = { status: "verified" };
          await verifyDatabaseCleanupMarker(databaseUrl, descriptor, cleanupOwnerDeadline);
          descriptor.cleanup.resources.database = { status: "verified" };
          verifyObjectRootForCleanup(descriptor);
          descriptor.cleanup.resources.objectStore = { status: "verified" };
          await dropExactDatabase(adminUrl, descriptor.database.name, cleanupOwnerDeadline);
          descriptor.cleanup.resources.database = { status: "removed" };
          rmSync(descriptor.objectStore.root, { recursive: true, force: false });
          await assertDatabaseAbsent(adminUrl, descriptor.database.name, cleanupOwnerDeadline);
          if (existsSync(descriptor.objectStore.root)) {
            throw new Error("Owned runtime object root still exists after cleanup.");
          }
          descriptor.cleanup.resources.objectStore = { status: "removed" };
          descriptor.cleanup.resources.descriptor = { status: "retained", reason: "Cleanup proof descriptor retained." };
          descriptor.run.state = "cleaned";
          descriptor.cleanup.status = "complete";
          descriptor.cleanup.completedAt = new Date().toISOString();
          writeDescriptor(descriptorPath, descriptor);
        } catch (error) {
          const cleanupErrors = [asError(error)];
          await finalizeRunningNestedRuntimesAfterFailure(
            descriptor.artifacts.nestedRuntimeManifest,
            "Gate0 success cleanup was refused; nested forensic resources retained.",
          ).catch((nestedError) => cleanupErrors.push(asError(nestedError)));
          await stopAndRecordOwnedProcesses(started, descriptor).catch((stopError) => cleanupErrors.push(asError(stopError)));
          retainPendingCleanupResources(descriptor, "Cleanup aborted after a fail-closed ownership or artifact check.");
          descriptor.cleanup.resources.descriptor = { status: "retained", reason: "Cleanup failure descriptor retained." };
          descriptor.run.state = "cleanup-failed-retained";
          descriptor.cleanup.status = "retained-on-failure";
          writeDescriptor(descriptorPath, descriptor);
          throw new AggregateError(cleanupErrors, "Gate0 exact cleanup failed; remaining owned resources were retained.");
        }
      },
    };
  } catch (error) {
    const failures = [asError(error)];
    await stopOwnedProcesses(started).catch((stopError) => failures.push(asError(stopError)));
    writeProvisionFailure(runRoot, {
      runId,
      sourceCommit: source.commit,
      databaseName: databaseCreated ? databaseName : undefined,
      objectRoot,
      errors: failures,
    });
    throw new AggregateError(failures, "Owned runtime provisioning failed; exact resources were retained.");
  }
}

export async function cleanupExactOrphanedOwnedRuntime(
  input: OrphanedOwnedRuntimeCleanupInput,
  dependencies: {
    verifyDatabaseMarker?: (databaseUrl: string, input: OrphanedOwnedRuntimeCleanupInput) => Promise<void>;
    assertPortsUnused?: (ports: number[]) => Promise<void>;
    dropDatabase?: (adminUrl: string, databaseName: string) => Promise<void>;
    assertDatabaseAbsent?: (adminUrl: string, databaseName: string) => Promise<void>;
  } = {},
) {
  const worktreeRoot = realpathSync(input.worktreeRoot);
  const runsRoot = path.join(worktreeRoot, defaultRunsRoot);
  const runRoot = realpathSync(input.runRoot);
  assertPathWithinWorktree(runsRoot, runRoot, "orphaned runtime cleanup target");
  if (path.basename(runRoot) !== input.runId) {
    throw new Error("Refusing orphan cleanup: run root and run ID mismatch.");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.sourceCommit)) {
    throw new Error("Refusing orphan cleanup: source commit must be exact.");
  }
  if (!/^wiseeff_acceptance_full_[a-z0-9_]+$/u.test(input.databaseName)) {
    throw new Error("Refusing orphan cleanup: database name is unsafe.");
  }
  const objectRoot = path.join(runRoot, "object-store");
  const markerPath = path.join(objectRoot, ".wiseeff-acceptance-owner.json");
  const objectStat = lstatSync(objectRoot);
  const markerStat = lstatSync(markerPath);
  if (objectStat.isSymbolicLink() || !objectStat.isDirectory() || markerStat.isSymbolicLink() || !markerStat.isFile()) {
    throw new Error("Refusing orphan cleanup: object root or marker is not a regular owned path.");
  }
  const marker = JSON.parse(readFileSync(markerPath, "utf8")) as Record<string, unknown>;
  if (
    marker.kind !== "wiseeff-owned-local-acceptance-object-store" ||
    marker.purpose !== OWNED_ACCEPTANCE_MARKER_PURPOSE ||
    marker.runId !== input.runId ||
    marker.sourceCommit !== input.sourceCommit
  ) {
    throw new Error("Refusing orphan cleanup: object marker identity mismatch.");
  }

  const databaseUrl = databaseUrlFor(input.baseDatabaseUrl, input.databaseName);
  const adminUrl = databaseUrlFor(input.baseDatabaseUrl, "postgres");
  await (dependencies.verifyDatabaseMarker ?? verifyOrphanDatabaseMarker)(databaseUrl, input);
  await (dependencies.assertPortsUnused ?? assertOwnedPortsUnused)(input.ports);
  await (dependencies.dropDatabase ?? ((url, name) => dropExactDatabase(url, name, input.ownerDeadline)))(adminUrl, input.databaseName);
  rmSync(objectRoot, { recursive: true, force: false });
  await (dependencies.assertDatabaseAbsent ?? ((url, name) => assertDatabaseAbsent(url, name, input.ownerDeadline)))(adminUrl, input.databaseName);
  if (existsSync(objectRoot)) throw new Error("Orphaned owned object root still exists after exact cleanup.");
  const evidencePath = path.join(runRoot, "exact-cleanup.json");
  writeFileSync(evidencePath, `${JSON.stringify({
    kind: "wiseeff-owned-local-acceptance-exact-cleanup",
    runId: input.runId,
    sourceCommit: input.sourceCommit,
    databaseName: input.databaseName,
    database: { status: "removed" },
    objectStore: { status: "removed" },
    ports: input.ports.map((port) => ({ port, status: "unused-before-cleanup" })),
    runRoot: { status: "retained-for-cleanup-evidence" },
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  return evidencePath;
}

async function verifyOrphanDatabaseMarker(databaseUrl: string, input: OrphanedOwnedRuntimeCleanupInput) {
  await withOwnerAwarePostgres({
    connectionString: databaseUrl,
    owner: input.ownerDeadline,
    stage: "orphan database marker verification",
  }, async (database) => {
    const result = await database.query<{ database_name: string; purpose: string; run_id: string; source_commit: string }>(
      `select current_database() as database_name, purpose, run_id, source_commit
       from ${OWNED_ACCEPTANCE_MARKER_TABLE} where purpose = $1`,
      [OWNED_ACCEPTANCE_MARKER_PURPOSE],
      "marker query",
    );
    const marker = result.rows[0];
    if (
      result.rows.length !== 1 ||
      marker?.database_name !== input.databaseName ||
      marker.purpose !== OWNED_ACCEPTANCE_MARKER_PURPOSE ||
      marker.run_id !== input.runId ||
      marker.source_commit !== input.sourceCommit
    ) {
      throw new Error("Refusing orphan cleanup: database marker identity mismatch.");
    }
  });
}

async function assertOwnedPortsUnused(ports: number[]) {
  for (const port of ports) {
    if (!Number.isSafeInteger(port) || port <= 0) throw new Error("Refusing orphan cleanup: invalid owned port.");
    const server = createServer();
    const available = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (!available) throw new Error(`Refusing orphan cleanup: port ${port} still has a listener.`);
  }
}

export async function readCleanSource(worktreeRoot: string, signal?: AbortSignal) {
  const commit = await runGit(worktreeRoot, ["rev-parse", "HEAD"], signal);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Owned runtime could not resolve exact source commit.");
  const status = await runGit(worktreeRoot, ["status", "--porcelain", "--untracked-files=all"], signal);
  if (status) throw new Error("Owned runtime requires a clean source worktree before provisioning.");
  return { commit };
}

async function runGit(cwd: string, args: string[], signal?: AbortSignal) {
  try {
    const result = await execFileAsync("git", args, { cwd, encoding: "utf8", signal });
    return result.stdout.trim();
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw new Error(`git ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
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

async function createCheckedAbsentDatabase(
  adminUrl: string,
  databaseName: string,
  owner?: OwnerAwarePostgresDeadline,
) {
  await withOwnerAwarePostgres({
    connectionString: adminUrl,
    owner,
    stage: "checked-absent database creation",
  }, async (database) => {
    const existing = await database.query(
      "select 1 from pg_database where datname = $1",
      [databaseName],
      "absence query",
    );
    if (existing.rows.length > 0) {
      throw new Error(`Owned runtime database must be absent before creation: ${databaseName}`);
    }
    await database.query(`create database ${quoteIdentifier(databaseName)}`, [], "create query");
  });
}

async function writeAndReadDatabaseMarker(
  databaseUrl: string,
  identity: { runId: string; sourceCommit: string },
  owner?: OwnerAwarePostgresDeadline,
) {
  return withOwnerAwarePostgres({
    connectionString: databaseUrl,
    owner,
    stage: "database marker and seed proof",
  }, async (database) => {
    await database.query(
      `create table ${OWNED_ACCEPTANCE_MARKER_TABLE} (
         purpose text primary key,
         run_id text not null,
         source_commit text not null,
         created_at timestamptz not null default now()
      )`,
      [],
      "marker table create",
    );
    await database.query(
      `insert into ${OWNED_ACCEPTANCE_MARKER_TABLE} (purpose, run_id, source_commit) values ($1, $2, $3)`,
      [OWNED_ACCEPTANCE_MARKER_PURPOSE, identity.runId, identity.sourceCommit],
      "marker insert",
    );
    const migrations = await database.query<{ name: string }>(
      "select name from schema_migrations order by name",
      [],
      "migration evidence query",
    );
    if (migrations.rows.length === 0) throw new Error("Owned runtime migration evidence is empty.");
    const sentinels: Record<string, number> = {};
    for (const table of ["organizations", "users", "projects", "log_records"]) {
      const result = await database.query<{ count: string }>(
        `select count(*)::text as count from ${table}`,
        [],
        `${table} seed sentinel query`,
      );
      sentinels[table] = Number(result.rows[0]?.count ?? 0);
      if (sentinels[table] <= 0) throw new Error(`Owned runtime seed sentinel ${table} is empty.`);
    }
    return {
      appliedCount: migrations.rows.length,
      latestMigration: migrations.rows.at(-1)!.name,
      completedAt: new Date().toISOString(),
      sentinels,
    };
  });
}

async function runNpmScriptWithLog(
  cwd: string,
  script: string,
  env: RuntimeEnv,
  logPath: string,
  owner?: ProvisionOwnedRuntimeOptions["ownerDeadline"],
) {
  owner?.remainingMs(script);
  const processRecord = spawnOwnedProcess({
    cwd,
    command: "npm",
    args: ["run", script],
    env,
    log: logPath,
  });
  const status = await waitForOwnedProcessGroupExit(processRecord.child, { signal: owner?.signal });
  if (status !== 0) throw new Error(`${script} failed with status ${status ?? "unknown"}; see ${logPath}.`);
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
      env: buildOwnedChildProcessEnv(input.env),
      stdio: ["ignore", fd, fd],
      detached: process.platform !== "win32",
    });
    const command = [input.command, ...input.args].join(" ");
    return { child, command, log: input.log };
  } finally {
    closeSync(fd);
  }
}

export function buildOwnedChildProcessEnv(
  ownedEnv: RuntimeEnv,
  inheritedEnv: RuntimeEnv = process.env,
): RuntimeEnv {
  const childEnv: RuntimeEnv = {};
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (!isGate0SecretEnvKey(key)) childEnv[key] = value;
  }
  for (const [key, value] of Object.entries(ownedEnv)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  return childEnv;
}

async function waitForHttp(
  url: string,
  child: ChildProcess,
  label: string,
  owner?: ProvisionOwnedRuntimeOptions["ownerDeadline"],
) {
  const deadline = Math.min(Date.now() + 90_000, owner?.deadlineAt ?? Number.POSITIVE_INFINITY);
  while (Date.now() < deadline) {
    owner?.remainingMs(`${label} HTTP startup`);
    if (child.exitCode != null) throw new Error(`Owned ${label} process exited with ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The exact owned process is still starting.
    }
    await sleepWithAbort(250, owner?.signal);
  }
  throw new Error(`Timed out waiting for owned ${label} runtime at ${url}.`);
}

function sleepWithAbort(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

async function stopOwnedProcesses(processes: StartedProcess[]) {
  const errors: Error[] = [];
  for (const processRecord of [...processes].reverse()) {
    try {
      await stopOwnedProcess(processRecord.child);
    } catch (error) {
      errors.push(asError(error));
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "One or more owned process trees could not be stopped.");
}

async function stopAndRecordOwnedProcesses(
  processes: StartedProcess[],
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1,
) {
  const errors: Error[] = [];
  for (const [label, processRecord] of ([
    ["frontendProcess", processes.find((entry) => entry.child.pid === descriptor.processes.frontend.pid)],
    ["apiProcess", processes.find((entry) => entry.child.pid === descriptor.processes.api.pid)],
  ] as const)) {
    if (!processRecord) {
      descriptor.cleanup.resources[label] = { status: "failed", reason: "Owned process record is missing." };
      errors.push(new Error(`${label} process record is missing.`));
      continue;
    }
    try {
      await stopOwnedProcess(processRecord.child);
      descriptor.cleanup.resources[label] = { status: "stopped" };
    } catch (error) {
      descriptor.cleanup.resources[label] = { status: "failed", reason: safeCleanupReason(error) };
      errors.push(asError(error));
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "One or more owned process trees could not be stopped.");
}

function setRetainedResources(descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1, reason: string) {
  descriptor.cleanup.resources.database = { status: "retained", reason };
  descriptor.cleanup.resources.objectStore = { status: "retained", reason };
}

function retainPendingCleanupResources(descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1, reason: string) {
  for (const resource of ["database", "objectStore", "artifacts"] as const) {
    if (["pending", "verified"].includes(descriptor.cleanup.resources[resource].status)) {
      descriptor.cleanup.resources[resource] = { status: "retained", reason };
    }
  }
}

function safeCleanupReason(error: unknown) {
  return sanitizeGate0DiagnosticText(error instanceof Error ? error.message : String(error)).value
    .replace(/authorization/giu, "credential-header")
    .replace(/auth.?secret/giu, "credential-secret");
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

async function stopOwnedProcess(child: ChildProcess) {
  await stopOwnedProcessGroup(child);
}

export function assertNestedRuntimesCleanedForSuccess(manifestPath: string) {
  const manifest = readNestedRuntimeManifest(manifestPath);
  const unclean = manifest.children.filter((child) =>
    child.state !== "cleaned" ||
    child.cleanup?.apiProcess.status !== "stopped" ||
    child.cleanup.frontendProcess.status !== "stopped" ||
    child.cleanup.database.status !== "removed" ||
    child.cleanup.objectStore.status !== "removed"
  );
  if (unclean.length > 0) {
    throw new Error(`Nested runtimes are not clean for Gate0 success: ${unclean.map((child) => `${child.id}:${child.state}`).join(", ")}.`);
  }
}

export async function finalizeRunningNestedRuntimesAfterFailure(
  manifestPath: string,
  retentionReason: string,
  options: StopOwnedProcessGroupOptions & {
    stopProcessGroup?: (pid: number, options?: StopOwnedProcessGroupOptions) => Promise<void>;
  } = {},
) {
  const manifest = readNestedRuntimeManifest(manifestPath);
  const errors: Error[] = manifest.children
    .filter((entry) => entry.state === "cleanup-failed")
    .map((entry) => new Error(`Nested runtime ${entry.id} already recorded a cleanup failure.`));
  const stopProcessGroup = options.stopProcessGroup ?? stopOwnedProcessGroup;
  const safeRetentionReason = safeCleanupReason(retentionReason);
  for (const child of manifest.children.filter((entry) =>
    entry.state === "provisioning" || entry.state === "running"
  )) {
    const cleanup: NestedRuntimeCleanup = {
      apiProcess: { status: "failed" as const, reason: "Nested API process cleanup did not settle." },
      frontendProcess: { status: "failed" as const, reason: "Nested frontend process cleanup did not settle." },
      database: { status: "retained" as const, reason: safeRetentionReason },
      objectStore: { status: "retained" as const, reason: safeRetentionReason },
    };
    for (const [label, pid] of [["apiProcess", child.apiPid], ["frontendProcess", child.frontendPid]] as const) {
      if (pid === undefined) {
        cleanup[label] = { status: "not-started" };
        continue;
      }
      try {
        await stopProcessGroup(pid, options);
        cleanup[label] = { status: "stopped" };
      } catch (error) {
        cleanup[label] = { status: "failed", reason: safeCleanupReason(error) };
        errors.push(asError(error));
      }
    }
    recordNestedRuntimeFinish(
      manifestPath,
      child.id,
      cleanup.apiProcess.status !== "failed" && cleanup.frontendProcess.status !== "failed"
        ? "failed-retained"
        : "cleanup-failed",
      cleanup,
    );
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "One or more nested process groups could not be stopped.");
  }
}

async function allocateAllowedLoopbackPort(
  range: { min: number; max: number },
  owner?: ProvisionOwnedRuntimeOptions["ownerDeadline"],
) {
  for (let port = range.min; port <= range.max; port += 1) {
    owner?.remainingMs("loopback port allocation");
    const available = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`No owned loopback port is available in ${range.min}-${range.max}.`);
}

function checkpointOwner(options: ProvisionOwnedRuntimeOptions, stage: string) {
  options.ownerDeadline?.remainingMs(stage);
}

export function buildOwnedRuntimeEnv(input: {
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
    VITE_XIAOZE_PROACTIVE_ENABLED: "false",
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
    ...buildOwnedRuntimeArtifactEnv(input.runRoot),
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
  owner?: OwnerAwarePostgresDeadline,
) {
  await withOwnerAwarePostgres({
    connectionString: databaseUrl,
    owner,
    stage: "database cleanup marker verification",
  }, async (database) => {
    const result = await database.query<{ database_name: string; run_id: string; source_commit: string; purpose: string }>(
      `select current_database() as database_name, run_id, source_commit, purpose
       from ${OWNED_ACCEPTANCE_MARKER_TABLE}
       where purpose = $1`,
      [OWNED_ACCEPTANCE_MARKER_PURPOSE],
      "marker query",
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
  });
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

async function dropExactDatabase(
  adminUrl: string,
  databaseName: string,
  owner?: OwnerAwarePostgresDeadline,
) {
  if (!/^wiseeff_acceptance_full_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Refusing destructive cleanup for database ${databaseName}.`);
  }
  await withOwnerAwarePostgres({
    connectionString: adminUrl,
    owner,
    stage: "exact database cleanup",
  }, (database) => database.query(
    `drop database ${quoteIdentifier(databaseName)} with (force)`,
    [],
    "drop query",
  ).then(() => undefined));
}

async function assertDatabaseAbsent(
  adminUrl: string,
  databaseName: string,
  owner?: OwnerAwarePostgresDeadline,
) {
  await withOwnerAwarePostgres({
    connectionString: adminUrl,
    owner,
    stage: "database absence verification",
  }, async (database) => {
    const result = await database.query(
      "select 1 from pg_database where datname = $1",
      [databaseName],
      "absence query",
    );
    if (result.rows.length > 0) throw new Error(`Owned runtime database still exists after cleanup: ${databaseName}`);
  });
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
    errors: Error[];
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
      failures: input.errors.map((error, index) => ({
        stage: index === 0 ? "provision" : "process-cleanup",
        message: safeCleanupReason(error),
      })),
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
