import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  readProcessStartIdentity,
  sameProcessStartIdentity,
  type ProcessStartIdentity,
} from "../../../scripts/process-start-identity";
import {
  withOwnerAwarePostgres,
  type OwnerAwarePostgresDeadline,
} from "../../../scripts/owner-aware-postgres";
import { OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV } from "./nestedRuntimeManifest";

const execFileAsync = promisify(execFile);

export const OWNED_ACCEPTANCE_DESCRIPTOR_ENV = "WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR";
export const OWNED_ACCEPTANCE_DATABASE_PREFIX = "wiseeff_acceptance_full_";
export const OWNED_ACCEPTANCE_MARKER_TABLE = "wiseeff_acceptance_runtime_markers";
export const OWNED_ACCEPTANCE_MARKER_PURPOSE = "td-122-gate0";
export const OWNED_API_PORT_RANGE = { min: 18_800, max: 18_899 } as const;
export const OWNED_FRONTEND_PORT_RANGE = { min: 5_180, max: 5_279 } as const;

export function buildOwnedRuntimeArtifactEnv(runRoot: string): Record<string, string> {
  const root = path.resolve(runRoot);
  return {
    WISEEFF_QUALITY_PLAYWRIGHT_OUTPUT_DIR: path.join(root, "artifacts", "visual", "test-results"),
    WISEEFF_QUALITY_PLAYWRIGHT_REPORT_DIR: path.join(root, "artifacts", "visual", "playwright-report"),
    WISEEFF_QUALITY_SNAPSHOT_ROOT: path.join(root, "artifacts", "visual", "snapshots"),
    WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR: path.join(root, "artifacts", "browser", "test-results"),
    WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR: path.join(root, "artifacts", "browser", "playwright-report"),
    WISEEFF_ACCEPTANCE_PREFLIGHT_EVIDENCE_OUT: path.join(root, "artifacts", "browser", "preflight", "evidence.md"),
    WISEEFF_ACCEPTANCE_BROWSER_EVIDENCE_OUT: path.join(root, "artifacts", "browser", "browser-evidence.md"),
    WISEEFF_ACCEPTANCE_OPERATION_EVIDENCE_OUT: path.join(root, "artifacts", "browser", "operation-evidence.md"),
    WISEEFF_ACCEPTANCE_OPERATION_EVIDENCE_JSON_OUT: path.join(root, "artifacts", "browser", "operation-evidence.json"),
  };
}

export type OwnedRuntimePhaseStatus = "pending" | "launching" | "running" | "passed" | "failed" | "blocked";

export type OwnedRuntimePhase = {
  status: OwnedRuntimePhaseStatus;
  process?: {
    pid: number;
    processIdentity: ProcessStartIdentity;
  };
  startedAt?: string;
  completedAt?: string;
  resultJson?: string;
  report?: string;
  preflightEvidence?: string;
  evidenceRunId?: string;
};

export type OwnedRuntimeCleanupResource = {
  status: "pending" | "stopped" | "verified" | "removed" | "retained" | "failed";
  reason?: string;
};

export type OwnedLocalAcceptanceRuntimeDescriptorV1 = {
  version: 1;
  kind: "wiseeff-owned-local-acceptance";
  run: {
    id: string;
    sourceCommit: string;
    worktreeRoot: string;
    sourceDirtyBefore: false;
    ownerPid: number;
    ownerProcessIdentity: ProcessStartIdentity;
    createdAt: string;
    state:
      | "provisioning"
      | "ready"
      | "running"
      | "failed-retained"
      | "cleanup-failed-retained"
      | "cleaned";
  };
  database: {
    name: string;
    connection: {
      host: string;
      port: number;
      user: string;
      database: string;
    };
    absentBeforeCreate: true;
    marker: {
      table: typeof OWNED_ACCEPTANCE_MARKER_TABLE;
      purpose: typeof OWNED_ACCEPTANCE_MARKER_PURPOSE;
      runId: string;
      sourceCommit: string;
    };
    migration: {
      command: "npm run db:migrate";
      appliedCount: number;
      latest: string;
      completedAt: string;
    };
    seed: {
      command: "npm run db:seed:all";
      completedAt: string;
      sentinels: Record<string, string | number>;
    };
  };
  objectStore: {
    mode: "local";
    root: string;
    absentBeforeCreate: true;
    markerFile: string;
    markerSha256: string;
  };
  endpoints: {
    api: {
      host: "127.0.0.1";
      port: number;
      url: string;
      healthUrl: string;
    };
    frontend: {
      host: "127.0.0.1";
      port: number;
      url: string;
    };
  };
  processes: {
    api: {
      pid: number;
      processIdentity: ProcessStartIdentity;
      startedAt: string;
      command: string;
      log: string;
    };
    frontend: {
      pid: number;
      processIdentity: ProcessStartIdentity;
      startedAt: string;
      command: string;
      log: string;
    };
  };
  auth: {
    mode: "production";
    provider: "hmac";
    issuer: string;
    smokeSubject: "u-xu-yun";
  };
  runtime: {
    frontendMode: "api";
    xiaozeDeterministic: true;
    logAnalysisDeterministic: true;
    localWebhookAllowed: true;
    gatewayMode: "simulator";
    hdcAvailable: false;
  };
  phases: {
    visual: OwnedRuntimePhase;
    browser: OwnedRuntimePhase;
  };
  artifacts: {
    runRoot: string;
    descriptor: string;
    operationEvidenceRuntimeSnapshot: string;
    failureInventory: string;
    sourceWorktreeOutputManifest: string;
    nestedRuntimeManifest: string;
    runtimeLogs: string[];
  };
  cleanup: {
    policy: "success-only";
    status: "pending" | "retained-on-failure" | "complete";
    exactDatabaseName: string;
    exactObjectStoreRoot: string;
    completedAt?: string;
    resources: {
      apiProcess: OwnedRuntimeCleanupResource;
      frontendProcess: OwnedRuntimeCleanupResource;
      database: OwnedRuntimeCleanupResource;
      objectStore: OwnedRuntimeCleanupResource;
      descriptor: OwnedRuntimeCleanupResource;
      artifacts: OwnedRuntimeCleanupResource;
    };
  };
};

type RuntimeEnv = Record<string, string | undefined>;

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function loadOwnedRuntimeDescriptor(
  descriptorPath = process.env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV],
): OwnedLocalAcceptanceRuntimeDescriptorV1 {
  if (!descriptorPath?.trim()) {
    throw new Error(`${OWNED_ACCEPTANCE_DESCRIPTOR_ENV} must name the owned runtime descriptor.`);
  }
  if (!path.isAbsolute(descriptorPath)) {
    throw new Error(`${OWNED_ACCEPTANCE_DESCRIPTOR_ENV} must be an absolute path.`);
  }

  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as unknown;
  assertOwnedRuntimeDescriptor(descriptor);
  if (realpathSync(path.dirname(descriptorPath)) !== realpathSync(descriptor.artifacts.runRoot)) {
    throw new Error("Owned runtime descriptor must live directly inside its run root.");
  }
  if (path.resolve(descriptor.artifacts.descriptor) !== path.resolve(descriptorPath)) {
    throw new Error("Owned runtime descriptor path does not match its artifact identity.");
  }
  return descriptor;
}

export function loadOwnedRuntimeDescriptorFromEnv(
  env: RuntimeEnv = process.env,
): OwnedLocalAcceptanceRuntimeDescriptorV1 | undefined {
  const descriptorPath = env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]?.trim();
  if (!descriptorPath) return undefined;
  const descriptor = loadOwnedRuntimeDescriptor(descriptorPath);
  assertOwnedRuntimeEnvironment(descriptor, env);
  return descriptor;
}

export function assertOwnedRuntimeEnvironment(
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1,
  env: RuntimeEnv = process.env,
) {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl || !sameDatabaseIdentity(databaseIdentityFromUrl(databaseUrl), descriptor.database.connection)) {
    throw new Error("Owned runtime DATABASE_URL identity does not match the descriptor.");
  }
  const authSecret = env.AUTH_TOKEN_HMAC_SECRET?.trim();
  if (
    !authSecret ||
    env.AUTH_MODE !== descriptor.auth.mode ||
    env.AUTH_PROVIDER !== descriptor.auth.provider ||
    env.AUTH_TOKEN_ISSUER !== descriptor.auth.issuer
  ) {
    throw new Error("Owned runtime authentication environment does not match the descriptor.");
  }
  if (env.WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID !== descriptor.run.id) {
    throw new Error("Owned runtime evidence run ID does not match the descriptor.");
  }
  if (env.WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT !== descriptor.run.sourceCommit) {
    throw new Error("Owned runtime evidence source commit does not match the descriptor.");
  }
  if (env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME !== "true") {
    throw new Error("Owned runtime consumers must disable Playwright webServer startup.");
  }
  if (env.WISEEFF_QUALITY_SKIP_SEED !== "true") {
    throw new Error("Owned runtime consumers must not reseed the quality runtime.");
  }
  if (env[OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV] !== descriptor.artifacts.nestedRuntimeManifest) {
    throw new Error("Owned runtime nested-runtime manifest does not match the descriptor.");
  }
  for (const key of [
    "WISEEFF_QUALITY_PLAYWRIGHT_OUTPUT_DIR",
    "WISEEFF_QUALITY_PLAYWRIGHT_REPORT_DIR",
    "WISEEFF_QUALITY_SNAPSHOT_ROOT",
    "WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR",
    "WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR",
    "WISEEFF_ACCEPTANCE_PREFLIGHT_EVIDENCE_OUT",
    "WISEEFF_ACCEPTANCE_BROWSER_EVIDENCE_OUT",
    "WISEEFF_ACCEPTANCE_OPERATION_EVIDENCE_OUT",
    "WISEEFF_ACCEPTANCE_OPERATION_EVIDENCE_JSON_OUT",
  ] as const) {
    const artifactPath = env[key]?.trim();
    if (!artifactPath || !path.isAbsolute(artifactPath) || !isDescendant(descriptor.artifacts.runRoot, artifactPath)) {
      throw new Error(`Owned runtime artifact path ${key} must be an absolute descendant of its run root.`);
    }
  }
  return descriptor;
}

export function assertOwnedRuntimeDescriptor(
  value: unknown,
): asserts value is OwnedLocalAcceptanceRuntimeDescriptorV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Owned runtime descriptor must be a JSON object.");
  }
  const descriptor = value as Partial<OwnedLocalAcceptanceRuntimeDescriptorV1>;
  if (descriptor.version !== 1 || descriptor.kind !== "wiseeff-owned-local-acceptance") {
    throw new Error("Unsupported owned runtime descriptor kind or version.");
  }
  assertNoSecrets(value);

  const run = requireRecord(descriptor.run, "run");
  requireString(run.id, "run.id");
  requireFullCommit(run.sourceCommit, "run.sourceCommit");
  requireAbsolutePath(run.worktreeRoot, "run.worktreeRoot");
  if (run.sourceDirtyBefore !== false) {
    throw new Error("Owned runtime requires a clean source worktree at provision time.");
  }
  requirePositiveInteger(run.ownerPid, "run.ownerPid");
  assertProcessIdentity(
    requireRecord(run.ownerProcessIdentity, "run.ownerProcessIdentity"),
    "run.ownerProcessIdentity",
  );
  requireString(run.createdAt, "run.createdAt");
  if (!["provisioning", "ready", "running", "failed-retained", "cleanup-failed-retained", "cleaned"].includes(String(run.state))) {
    throw new Error("Owned runtime descriptor has an invalid run state.");
  }

  const database = requireRecord(descriptor.database, "database");
  const databaseName = requireString(database.name, "database.name");
  if (!/^wiseeff_acceptance_full_[a-z0-9_]+$/.test(databaseName) || databaseName.length > 63) {
    throw new Error(`Refusing owned runtime database name ${databaseName}.`);
  }
  const connection = requireRecord(database.connection, "database.connection");
  requireString(connection.host, "database.connection.host");
  requirePositiveInteger(connection.port, "database.connection.port");
  requireString(connection.user, "database.connection.user");
  if (connection.database !== databaseName) {
    throw new Error("Owned runtime database connection identity does not match its database name.");
  }
  if (database.absentBeforeCreate !== true) {
    throw new Error("Owned runtime database must be checked absent before creation.");
  }
  const marker = requireRecord(database.marker, "database.marker");
  if (marker.table !== OWNED_ACCEPTANCE_MARKER_TABLE || marker.purpose !== OWNED_ACCEPTANCE_MARKER_PURPOSE) {
    throw new Error("Owned runtime database marker identity is invalid.");
  }
  if (marker.runId !== run.id || marker.sourceCommit !== run.sourceCommit) {
    throw new Error("Owned runtime database marker does not match run/source identity.");
  }
  const migration = requireRecord(database.migration, "database.migration");
  if (migration.command !== "npm run db:migrate") throw new Error("Owned runtime migration command is invalid.");
  requirePositiveInteger(migration.appliedCount, "database.migration.appliedCount");
  requireString(migration.latest, "database.migration.latest");
  requireString(migration.completedAt, "database.migration.completedAt");
  const seed = requireRecord(database.seed, "database.seed");
  if (seed.command !== "npm run db:seed:all") throw new Error("Owned runtime seed command is invalid.");
  requireString(seed.completedAt, "database.seed.completedAt");
  requireRecord(seed.sentinels, "database.seed.sentinels");

  const objectStore = requireRecord(descriptor.objectStore, "objectStore");
  if (objectStore.mode !== "local" || objectStore.absentBeforeCreate !== true) {
    throw new Error("Owned runtime requires a checked-absent local object store.");
  }
  requireAbsolutePath(objectStore.root, "objectStore.root");
  requireAbsolutePath(objectStore.markerFile, "objectStore.markerFile");
  requireSha256(objectStore.markerSha256, "objectStore.markerSha256");

  const endpoints = requireRecord(descriptor.endpoints, "endpoints");
  const api = requireRecord(endpoints.api, "endpoints.api");
  const frontend = requireRecord(endpoints.frontend, "endpoints.frontend");
  assertEndpoint(api, "api", OWNED_API_PORT_RANGE);
  assertEndpoint(frontend, "frontend", OWNED_FRONTEND_PORT_RANGE);
  if (api.port === frontend.port) throw new Error("Owned runtime endpoints must use distinct ports.");
  requireString(api.healthUrl, "endpoints.api.healthUrl");

  const processes = requireRecord(descriptor.processes, "processes");
  assertProcess(requireRecord(processes.api, "processes.api"), "api");
  assertProcess(requireRecord(processes.frontend, "processes.frontend"), "frontend");

  const auth = requireRecord(descriptor.auth, "auth");
  if (auth.mode !== "production" || auth.provider !== "hmac" || auth.smokeSubject !== "u-xu-yun") {
    throw new Error("Owned runtime authentication contract is invalid.");
  }
  requireString(auth.issuer, "auth.issuer");

  const runtime = requireRecord(descriptor.runtime, "runtime");
  if (
    runtime.frontendMode !== "api" ||
    runtime.xiaozeDeterministic !== true ||
    runtime.logAnalysisDeterministic !== true ||
    runtime.localWebhookAllowed !== true ||
    runtime.gatewayMode !== "simulator" ||
    runtime.hdcAvailable !== false
  ) {
    throw new Error("Owned runtime deterministic-mode contract is invalid.");
  }

  const phases = requireRecord(descriptor.phases, "phases");
  assertPhase(requireRecord(phases.visual, "phases.visual"), "visual");
  assertPhase(requireRecord(phases.browser, "phases.browser"), "browser");

  const artifacts = requireRecord(descriptor.artifacts, "artifacts");
  const runRoot = requireAbsolutePath(artifacts.runRoot, "artifacts.runRoot");
  const artifactPaths = [
    requireAbsolutePath(artifacts.descriptor, "artifacts.descriptor"),
    requireAbsolutePath(artifacts.operationEvidenceRuntimeSnapshot, "artifacts.operationEvidenceRuntimeSnapshot"),
    requireAbsolutePath(artifacts.failureInventory, "artifacts.failureInventory"),
    requireAbsolutePath(artifacts.sourceWorktreeOutputManifest, "artifacts.sourceWorktreeOutputManifest"),
    requireAbsolutePath(artifacts.nestedRuntimeManifest, "artifacts.nestedRuntimeManifest"),
  ];
  if (artifactPaths.some((artifactPath) => !isDescendant(runRoot, artifactPath))) {
    throw new Error("Owned runtime artifact path escapes its run root.");
  }
  if (!Array.isArray(artifacts.runtimeLogs) || artifacts.runtimeLogs.length !== 2) {
    throw new Error("Owned runtime must record API and frontend logs.");
  }
  artifacts.runtimeLogs.forEach((entry, index) => {
    const logPath = requireAbsolutePath(entry, `artifacts.runtimeLogs[${index}]`);
    if (!isDescendant(runRoot, logPath)) throw new Error("Owned runtime log path escapes its run root.");
  });

  const cleanup = requireRecord(descriptor.cleanup, "cleanup");
  if (cleanup.policy !== "success-only" || !["pending", "retained-on-failure", "complete"].includes(String(cleanup.status))) {
    throw new Error("Owned runtime cleanup contract is invalid.");
  }
  if (cleanup.exactDatabaseName !== database.name || cleanup.exactObjectStoreRoot !== objectStore.root) {
    throw new Error("Owned runtime cleanup targets do not match provisioned resources.");
  }
  const cleanupResources = requireRecord(cleanup.resources, "cleanup.resources");
  for (const resource of ["apiProcess", "frontendProcess", "database", "objectStore", "descriptor", "artifacts"] as const) {
    const result = requireRecord(cleanupResources[resource], `cleanup.resources.${resource}`);
    if (!["pending", "stopped", "verified", "removed", "retained", "failed"].includes(String(result.status))) {
      throw new Error(`Owned runtime cleanup resource ${resource} has an invalid status.`);
    }
    if (result.reason !== undefined) requireString(result.reason, `cleanup.resources.${resource}.reason`);
  }
}

export async function verifyOwnedRuntimeOwnership(
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1,
  env: RuntimeEnv = process.env,
  owner?: OwnerAwarePostgresDeadline,
) {
  assertOwnedRuntimeDescriptor(descriptor);
  if (!(["ready", "running"] as const).includes(descriptor.run.state as "ready" | "running")) {
    throw new Error(`Owned runtime cannot be consumed in state ${descriptor.run.state}.`);
  }

  await assertOwnedEndpointProcess(
    "api",
    descriptor.endpoints.api.port,
    descriptor.processes.api.pid,
    descriptor.processes.api.processIdentity,
  );
  await assertOwnedEndpointProcess(
    "frontend",
    descriptor.endpoints.frontend.port,
    descriptor.processes.frontend.pid,
    descriptor.processes.frontend.processIdentity,
  );

  assertOwnedRuntimeEnvironment(descriptor, env);
  const databaseUrl = env.DATABASE_URL!.trim();

  await verifyDatabaseMarker(databaseUrl, descriptor, owner);
  verifyObjectStoreMarker(descriptor);

  for (const url of [descriptor.endpoints.api.healthUrl, descriptor.endpoints.frontend.url]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error(`Owned runtime endpoint is unhealthy: ${url} returned ${response.status}.`);
  }
  await verifyOwnedAuthentication(descriptor, env);

  return descriptor;
}

async function assertOwnedEndpointProcess(
  label: string,
  port: number,
  expectedPid: number,
  expectedIdentity: ProcessStartIdentity,
) {
  if (!sameProcessStartIdentity(expectedIdentity, readProcessStartIdentity(expectedPid))) {
    throw new Error(`Owned ${label} process-start identity changed for PID ${expectedPid}; refusing the listener on port ${port}.`);
  }
  if (!processExists(expectedPid)) {
    throw new Error(`Owned ${label} process PID ${expectedPid} is not alive; refusing the listener on port ${port}.`);
  }
  const listenerPids = await listeningPids(port);
  if (listenerPids.length !== 1 || listenerPids[0] !== expectedPid) {
    throw new Error(
      `Owned ${label} PID mismatch on port ${port}: expected ${expectedPid}, observed ${listenerPids.join(", ") || "none"}.`,
    );
  }
}

async function listeningPids(port: number) {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `(Get-NetTCPConnection -State Listen -LocalPort ${port}).OwningProcess`,
    ]);
    return uniquePids(stdout);
  }

  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return uniquePids(stdout);
  } catch (error) {
    const exitCode = (error as { code?: unknown }).code;
    if (exitCode === 1) return [];
    throw new Error(`Cannot prove listener ownership for port ${port}: ${String(error)}`);
  }
}

function uniquePids(stdout: string) {
  return Array.from(
    new Set(
      stdout
        .split(/\s+/)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isSafeInteger(value) && value > 0),
    ),
  ).sort((left, right) => left - right);
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function verifyDatabaseMarker(
  databaseUrl: string,
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1,
  owner?: OwnerAwarePostgresDeadline,
) {
  await withOwnerAwarePostgres({
    connectionString: databaseUrl,
    owner,
    stage: "owned runtime marker verification",
  }, async (database) => {
    const result = await database.query<{
      database_name: string;
      run_id: string;
      source_commit: string;
      purpose: string;
    }>(
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
      row.source_commit !== descriptor.run.sourceCommit ||
      row.purpose !== OWNED_ACCEPTANCE_MARKER_PURPOSE
    ) {
      throw new Error("Owned runtime database marker does not match descriptor run/source identity.");
    }
  });
}

function verifyObjectStoreMarker(descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1) {
  const runRoot = realpathSync(descriptor.artifacts.runRoot);
  const objectStat = lstatSync(descriptor.objectStore.root);
  if (objectStat.isSymbolicLink()) throw new Error("Owned runtime object root must not be a symbolic link.");
  const objectRoot = realpathSync(descriptor.objectStore.root);
  if (!isDescendant(runRoot, objectRoot)) {
    throw new Error("Owned runtime object root escapes its run root.");
  }
  const markerStat = lstatSync(descriptor.objectStore.markerFile);
  if (markerStat.isSymbolicLink()) throw new Error("Owned runtime object marker must not be a symbolic link.");
  const markerContent = readFileSync(descriptor.objectStore.markerFile, "utf8");
  if (sha256(markerContent) !== descriptor.objectStore.markerSha256) {
    throw new Error("Owned runtime object marker digest does not match the descriptor.");
  }
  const marker = JSON.parse(markerContent) as { runId?: string; sourceCommit?: string };
  if (marker.runId !== descriptor.run.id || marker.sourceCommit !== descriptor.run.sourceCommit) {
    throw new Error("Owned runtime object marker does not match descriptor run/source identity.");
  }
}

export function databaseIdentityFromUrl(connectionString: string) {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Owned runtime database URL must use postgres or postgresql.");
  }
  const port = url.port ? Number.parseInt(url.port, 10) : 5432;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !url.username || !database || !Number.isSafeInteger(port) || port <= 0) {
    throw new Error("Owned runtime database URL has an incomplete non-secret identity.");
  }
  return {
    host: url.hostname,
    port,
    user: decodeURIComponent(url.username),
    database,
  };
}

function sameDatabaseIdentity(
  left: ReturnType<typeof databaseIdentityFromUrl>,
  right: OwnedLocalAcceptanceRuntimeDescriptorV1["database"]["connection"],
) {
  return left.host === right.host && left.port === right.port && left.user === right.user && left.database === right.database;
}

async function verifyOwnedAuthentication(
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1,
  env: RuntimeEnv,
) {
  const authorization = env.VITE_WISEEFF_API_AUTHORIZATION?.trim();
  if (!authorization) throw new Error("Owned runtime live authentication proof requires browser authorization.");
  const response = await fetch(`${descriptor.endpoints.api.url}/api/v1/me`, {
    headers: { authorization },
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`Owned runtime live authentication proof returned ${response.status}.`);
  const body = await response.json() as { user?: { id?: string } };
  if (body.user?.id !== descriptor.auth.smokeSubject) {
    throw new Error("Owned runtime live authentication subject does not match the descriptor.");
  }
}

function isDescendant(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertNoSecrets(value: unknown, at = "descriptor") {
  if (typeof value === "string") {
    if (/\bBearer\s+[A-Za-z0-9._~-]+/iu.test(value) || /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/iu.test(value)) {
      throw new Error(`Owned runtime descriptor must not contain secret value at ${at}.`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const processIdentityField = isAllowedProcessIdentityField(at, key);
    if (
      /sha256$/iu.test(key) && !processIdentityField &&
      !(at === "descriptor.objectStore" && key === "markerSha256")
    ) {
      throw new Error(`Owned runtime descriptor must not contain secret-derived verifier ${at}.${key}.`);
    }
    if (
      key !== "markerSha256" && !processIdentityField &&
      /(password|authorization|bearer|database.?url|connection.?string|token|secret|api.?key)/i.test(key)
    ) {
      throw new Error(`Owned runtime descriptor must not contain secret field ${at}.${key}.`);
    }
    assertNoSecrets(nested, `${at}.${key}`);
  }
}

function isAllowedProcessIdentityField(at: string, key: string) {
  return (
    /^descriptor\.processes\.(?:api|frontend)\.processIdentity$/u.test(at) ||
    at === "descriptor.run.ownerProcessIdentity" ||
    /^descriptor\.phases\.(?:visual|browser)\.process\.processIdentity$/u.test(at)
  ) &&
    (key === "startToken" || key === "commandSha256");
}

function assertEndpoint(
  value: Record<string, unknown>,
  label: string,
  range: { min: number; max: number },
) {
  if (value.host !== "127.0.0.1") throw new Error(`Owned ${label} endpoint must be loopback-only.`);
  const port = requirePositiveInteger(value.port, `endpoints.${label}.port`);
  if (port < range.min || port > range.max) {
    throw new Error(`Owned ${label} port ${port} is outside ${range.min}-${range.max}.`);
  }
  const url = requireString(value.url, `endpoints.${label}.url`);
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || Number(parsed.port) !== port) {
    throw new Error(`Owned ${label} URL does not match its loopback port.`);
  }
}

function assertProcess(value: Record<string, unknown>, label: string) {
  requirePositiveInteger(value.pid, `processes.${label}.pid`);
  const identity = requireRecord(value.processIdentity, `processes.${label}.process-start identity`);
  assertProcessIdentity(identity, `processes.${label}.process-start identity`);
  requireString(value.startedAt, `processes.${label}.startedAt`);
  requireString(value.command, `processes.${label}.command`);
  requireAbsolutePath(value.log, `processes.${label}.log`);
}

function assertPhase(value: Record<string, unknown>, label: string) {
  if (!["pending", "launching", "running", "passed", "failed", "blocked"].includes(String(value.status))) {
    throw new Error(`Owned runtime phase ${label} has an invalid status.`);
  }
  if (value.process !== undefined) {
    const process = requireRecord(value.process, `phases.${label}.process`);
    requirePositiveInteger(process.pid, `phases.${label}.process.pid`);
    assertProcessIdentity(
      requireRecord(process.processIdentity, `phases.${label}.process.processIdentity`),
      `phases.${label}.process.processIdentity`,
    );
  }
  if (value.status === "running" && value.process === undefined) {
    throw new Error(`Owned runtime running phase ${label} lacks a process-start identity.`);
  }
}

function assertProcessIdentity(value: Record<string, unknown>, label: string) {
  requireString(value.startToken, `${label} start token`);
  requireSha256(value.commandSha256, `${label} command digest`);
}

function requireRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Owned runtime descriptor requires ${label}.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Owned runtime descriptor requires non-empty ${label}.`);
  }
  return value;
}

function requireFullCommit(value: unknown, label: string) {
  const commit = requireString(value, label);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Owned runtime descriptor requires exact ${label}.`);
  return commit;
}

function requireSha256(value: unknown, label: string) {
  const digest = requireString(value, label);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Owned runtime descriptor requires SHA-256 ${label}.`);
  return digest;
}

function requirePositiveInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`Owned runtime descriptor requires positive integer ${label}.`);
  }
  return Number(value);
}

function requireAbsolutePath(value: unknown, label: string) {
  const filePath = requireString(value, label);
  if (!path.isAbsolute(filePath)) throw new Error(`Owned runtime descriptor requires absolute ${label}.`);
  return filePath;
}
