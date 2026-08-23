import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { rm, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

import { seedBaselinePlatformRoles } from "../../../server/modules/auth/baselineCatalog";
import {
  applyParameterIdentityCutover,
  migrateParameterIdentities,
} from "../../../server/modules/parameter-topology/migration";
import { createDatabase, type Database } from "../../../server/shared/database/client";
import { applyMigrations } from "../../../server/shared/database/migrations";
import { ACCEPTANCE_ORGANIZATION, acceptanceCast, chargeLabCast } from "./cast";
import {
  OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV,
  OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV,
  recordNestedRuntimeFinish,
  recordNestedRuntimeProgress,
  recordNestedRuntimeProvisioning,
  type NestedRuntimeCleanup,
} from "./nestedRuntimeManifest";
import { OWNED_ACCEPTANCE_DESCRIPTOR_ENV } from "./ownedRuntimeDescriptor";
import { stopOwnedProcessGroup } from "../../../scripts/owned-process-group";
import { buildGate0OwnedChildProcessEnv } from "../../../scripts/gate0-child-process-env";
import { registerGate0GeneratedSecrets } from "../../../scripts/gate0-secret-registry";
import { readProcessStartIdentity } from "../../../scripts/process-start-identity";

const databasePrefix = "wiseeff_acceptance_disposable_";
/** Topology suites omit `markerPurpose`; keep this default so their marker check stays unchanged. */
export const DEFAULT_DISPOSABLE_MARKER_PURPOSE = "parameter-topology";
const organizationId = ACCEPTANCE_ORGANIZATION.id;
const projectId = "aurora";
const maintenanceToken = "round6-disposable-acceptance-only";
const migrationsDir = path.resolve(process.cwd(), "server/migrations");

type RuntimeEnv = Record<string, string | undefined>;

export type DisposableDatabaseIdentity = {
  databaseName: string;
  markerPurpose: string;
  markerMigrationRunId: string;
  cutoverMigrationRunId: string;
  expectedMigrationRunId: string;
};

export type DisposablePostCutoverRuntime = {
  databaseUrl: string;
  databaseName: string;
  migrationRunId: string;
  markerPurpose: string;
  apiUrl: string;
  frontendUrl: string;
  authIssuer: string;
  authSecret: string;
  nestedRuntimeId?: string;
  dispose(outcome?: DisposableRuntimeOutcome): Promise<void>;
};

export type DisposableRuntimeOutcome = "success" | "failure";

type DisposableProcessCleanupResult = Pick<
  NestedRuntimeCleanup,
  "apiProcess" | "frontendProcess"
> & { errors: Error[] };

export type FinalizeDisposableRuntimeResourcesInput = {
  outcome: DisposableRuntimeOutcome;
  retainFailureResources: boolean;
  stopProcesses(): Promise<DisposableProcessCleanupResult>;
  removeDatabase(): Promise<void>;
  removeObjectStore(): Promise<void>;
};

export function disposableRuntimeOutcomeFromTestInfo(
  testInfo: { status: string; expectedStatus: string },
): DisposableRuntimeOutcome {
  return testInfo.status === testInfo.expectedStatus ? "success" : "failure";
}

export async function finalizeDisposableRuntimeResources(
  input: FinalizeDisposableRuntimeResourcesInput,
) {
  const cleanup: NestedRuntimeCleanup = nestedCleanupPending();
  const processCleanup = await input.stopProcesses();
  cleanup.apiProcess = processCleanup.apiProcess;
  cleanup.frontendProcess = processCleanup.frontendProcess;
  const errors = [...processCleanup.errors];

  if (input.outcome === "failure" && input.retainFailureResources) {
    const reason = "Playwright phase failed; nested forensic resources retained for Gate0 ownership.";
    cleanup.database = { status: "retained", reason };
    cleanup.objectStore = { status: "retained", reason };
    return {
      state: errors.length === 0 ? "failed-retained" as const : "cleanup-failed" as const,
      cleanup,
      errors,
    };
  }

  if (errors.length === 0) {
    await input.removeDatabase().then(
      () => { cleanup.database = { status: "removed" }; },
      (error) => {
        cleanup.database = { status: "failed", reason: safeNestedCleanupReason(error) };
        errors.push(asNestedError(error));
      },
    );
    await input.removeObjectStore().then(
      () => { cleanup.objectStore = { status: "removed" }; },
      (error) => {
        cleanup.objectStore = { status: "failed", reason: safeNestedCleanupReason(error) };
        errors.push(asNestedError(error));
      },
    );
  }

  return {
    state: errors.length === 0 ? "cleaned" as const : "cleanup-failed" as const,
    cleanup,
    errors,
  };
}

export type StartDisposablePostCutoverRuntimeOptions = {
  label?: string;
  apiPort?: number;
  frontendPort?: number;
  markerPurpose?: string;
  /** Extra env for the disposable API process (does not change topology defaults). */
  apiEnv?: Record<string, string>;
  /** Extra env for the disposable Vite process. */
  frontendEnv?: Record<string, string>;
};

export type NestedObjectStoreOwnership = {
  root: string;
  containerRoot: string;
  markerPath: string;
  markerSha256: string;
  databaseName: string;
};

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "run";
}

export function buildDisposableDatabaseName(label: string) {
  const boundedLabel = safeSegment(label).slice(0, 12);
  return `${databasePrefix}${boundedLabel}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

export function prepareNestedObjectStoreRoot(
  databaseName: string,
  nestedManifestPath?: string,
): NestedObjectStoreOwnership {
  if (!databaseName.startsWith(databasePrefix)) {
    throw new Error("Nested object-store ownership requires an exact disposable database identity.");
  }
  let containerRoot: string;
  if (nestedManifestPath) {
    if (!path.isAbsolute(nestedManifestPath)) throw new Error("Nested runtime manifest must be absolute.");
    const manifestStat = lstatSync(nestedManifestPath);
    if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
      throw new Error("Nested runtime manifest must be a regular parent-run artifact.");
    }
    const parentRunRoot = realpathSync(path.dirname(nestedManifestPath));
    containerRoot = path.join(parentRunRoot, "nested-object-store");
    if (existsSync(containerRoot)) {
      const stat = lstatSync(containerRoot);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("Nested object-store container must be a regular parent-run directory.");
      }
    } else {
      mkdirSync(containerRoot);
    }
  } else {
    containerRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-disposable-object-store-"));
  }
  const root = path.join(containerRoot, databaseName);
  assertStrictRealDescendant(containerRoot, root, false);
  if (existsSync(root)) throw new Error(`Nested object-store root must be absent before creation: ${root}`);
  mkdirSync(root);
  const markerPath = path.join(root, ".wiseeff-nested-runtime-owner.json");
  const markerContent = `${JSON.stringify({
    kind: "wiseeff-owned-nested-runtime-object-store",
    databaseName,
  }, null, 2)}\n`;
  writeFileSync(markerPath, markerContent, { encoding: "utf8", flag: "wx" });
  return {
    root,
    containerRoot,
    markerPath,
    markerSha256: createHash("sha256").update(markerContent).digest("hex"),
    databaseName,
  };
}

export async function removeNestedObjectStoreRoot(ownership: NestedObjectStoreOwnership) {
  assertStrictRealDescendant(ownership.containerRoot, ownership.root, true);
  const rootStat = lstatSync(ownership.root);
  const markerStat = lstatSync(ownership.markerPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || markerStat.isSymbolicLink() || !markerStat.isFile()) {
    throw new Error("Refusing nested owned object cleanup: root or marker is a symbolic link or non-regular path.");
  }
  const markerContent = readFileSync(ownership.markerPath, "utf8");
  const marker = JSON.parse(markerContent) as { kind?: string; databaseName?: string };
  if (
    marker.kind !== "wiseeff-owned-nested-runtime-object-store" ||
    marker.databaseName !== ownership.databaseName ||
    createHash("sha256").update(markerContent).digest("hex") !== ownership.markerSha256
  ) {
    throw new Error("Refusing nested owned object cleanup: ownership marker identity mismatch.");
  }
  await rm(ownership.root, { recursive: true, force: false });
  if (existsSync(ownership.root)) throw new Error("Nested owned object root still exists after removal.");
}

function assertStrictRealDescendant(containerRoot: string, candidate: string, requireExisting: boolean) {
  const resolvedContainer = realpathSync(containerRoot);
  const lexicalRelative = path.relative(resolvedContainer, path.resolve(candidate));
  if (!lexicalRelative || lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) {
    throw new Error("Nested owned object root must be a strict descendant of its owned container.");
  }
  if (requireExisting) {
    const actualRelative = path.relative(resolvedContainer, realpathSync(candidate));
    if (!actualRelative || actualRelative.startsWith("..") || path.isAbsolute(actualRelative)) {
      throw new Error("Nested owned object root resolves outside its owned container.");
    }
  }
}

export function assertDisposableDatabaseIdentity(
  identity: DisposableDatabaseIdentity,
  expectedPurpose = DEFAULT_DISPOSABLE_MARKER_PURPOSE,
) {
  if (!identity.databaseName.startsWith(databasePrefix)) {
    throw new Error(`Refusing destructive acceptance cleanup: invalid disposable database name ${identity.databaseName}.`);
  }
  if (identity.markerPurpose !== expectedPurpose) {
    throw new Error(`Refusing disposable database use: missing ${expectedPurpose} test-only marker.`);
  }
  if (
    !identity.expectedMigrationRunId ||
    identity.markerMigrationRunId !== identity.expectedMigrationRunId ||
    identity.cutoverMigrationRunId !== identity.expectedMigrationRunId
  ) {
    throw new Error("Refusing disposable database use: migration run marker does not match the applied cutover.");
  }
}

export async function allocateLoopbackPort(options: {
  min?: number;
  max?: number;
  excluded?: ReadonlySet<number>;
} = {}) {
  const excluded = options.excluded ?? new Set<number>();
  const candidates = options.min === undefined
    ? [0]
    : Array.from(
        { length: (options.max ?? options.min) - options.min + 1 },
        (_, index) => options.min! + index,
      );
  for (const candidate of candidates) {
    const port = await new Promise<number | null>((resolve, reject) => {
      const server = createServer();
      server.once("error", () => resolve(null));
      server.listen(candidate, "127.0.0.1", () => {
        const address = server.address();
        const allocated = address && typeof address === "object" ? address.port : 0;
        server.close((error) => (error ? reject(error) : resolve(allocated)));
      });
    });
    if (port && !excluded.has(port)) return port;
  }
  throw new Error(`No disposable loopback port is available in ${options.min ?? "ephemeral"}-${options.max ?? "ephemeral"}.`);
}

function databaseUrlFor(baseUrl: string, databaseName: string) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function adminDatabaseUrl(baseUrl: string) {
  return databaseUrlFor(baseUrl, "postgres");
}

async function withClient<T>(connectionString: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function withDatabase<T>(connectionString: string, fn: (db: Database) => Promise<T>): Promise<T> {
  return withClient(connectionString, async (client) =>
    fn(
      createDatabase({
        query: async (text, values = []) => {
          const result = await client.query(text, values);
          return { rows: result.rows, rowCount: result.rowCount };
        },
      }),
    ),
  );
}

async function seedAcceptanceScope(db: Database) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'ChargeLab')`,
    [organizationId],
  );
  for (const member of chargeLabCast) {
    await db.query(
      `insert into users (id, organization_id, name, email, title, is_active)
       values ($1, $2, $3, $4, $5, true)`,
      [member.userId, organizationId, member.name, member.email, member.title],
    );
  }
  await seedBaselinePlatformRoles(db);
  await db.query(
    `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
     values ('urb-disposable-admin', $2, $1, null, 'admin')`,
    [organizationId, acceptanceCast.xuYun.userId],
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Aurora disposable topology acceptance', 'AURORA', 'initialized')`,
    [projectId, organizationId],
  );
  const bindings = [
    [acceptanceCast.wangJie.userId, "hardware-committer"],
    [acceptanceCast.liPeng.userId, "hardware-committer"],
    [acceptanceCast.sunMei.userId, "software-committer"],
    [acceptanceCast.liuMin.userId, "software-user"],
    [acceptanceCast.chenNa.userId, "software-user"],
  ] as const;
  for (const [userId, roleId] of bindings) {
    await db.query(
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
       values ($1, $2, $3, $4, $5)`,
      [`urb-disposable-${userId}-${roleId}`, userId, organizationId, projectId, roleId],
    );
  }
}

async function preparePostCutoverDatabase(databaseUrl: string, purpose: string) {
  return withDatabase(databaseUrl, async (db) => {
    await applyMigrations(db, migrationsDir);
    await seedAcceptanceScope(db);
    const report = await migrateParameterIdentities(db, {
      mode: "apply",
      maintenanceToken,
      expectedMaintenanceToken: maintenanceToken,
      writeLockConfirmed: true,
      dbSnapshotId: "disposable-test-db",
      objectSnapshotId: "disposable-test-object-store",
    });
    if (report.blockers.length > 0) {
      throw new Error(`Disposable post-cutover migration was blocked: ${report.blockers.join("; ")}`);
    }
    await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
    // Cutover SQL re-imposes NOT NULL on semantic FKs. Production applied 0069/0070
    // after that historical cutover (ADR-0003 enablement drafts with null binding id).
    // Disposable runs cutover last, so replay those files to match production schema.
    await db.query(await readFile(path.join(migrationsDir, "0069_node_enablement_drafts.sql"), "utf8"));
    await db.query(await readFile(path.join(migrationsDir, "0070_node_enablement_change_requests.sql"), "utf8"));
    const enablementNullability = await db.query<{ is_nullable: string }>(
      `
      select is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'parameter_drafts'
        and column_name = 'project_parameter_binding_id'
      `,
    );
    if (enablementNullability.rows[0]?.is_nullable !== "YES") {
      throw new Error(
        "Disposable post-cutover schema must allow null parameter_drafts.project_parameter_binding_id for node-enablement drafts.",
      );
    }
    await db.query(
      `create table wiseeff_acceptance_test_markers (
         purpose text primary key,
         migration_run_id text not null,
         created_at timestamptz not null default now()
       )`,
    );
    await db.query(
      `insert into wiseeff_acceptance_test_markers (purpose, migration_run_id) values ($1, $2)`,
      [purpose, report.migrationRunId],
    );
    return report.migrationRunId;
  });
}

async function verifyPostCutoverDatabase(
  databaseUrl: string,
  expectedMigrationRunId: string,
  purpose: string,
) {
  await withClient(databaseUrl, async (client) => {
    const result = await client.query<{
      database_name: string;
      purpose: string;
      marker_migration_run_id: string;
      cutover_migration_run_id: string;
    }>(
      `select current_database() as database_name,
              marker.purpose,
              marker.migration_run_id as marker_migration_run_id,
              cutover.migration_run_id as cutover_migration_run_id
       from wiseeff_acceptance_test_markers marker
       inner join parameter_identity_cutovers cutover
         on cutover.migration_run_id = marker.migration_run_id
       where marker.purpose = $1`,
      [purpose],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Disposable acceptance marker or matching cutover is missing.");
    assertDisposableDatabaseIdentity(
      {
        databaseName: row.database_name,
        markerPurpose: row.purpose,
        markerMigrationRunId: row.marker_migration_run_id,
        cutoverMigrationRunId: row.cutover_migration_run_id,
        expectedMigrationRunId,
      },
      purpose,
    );
  });
}

async function waitForHttp(url: string, process: ChildProcess) {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    if (process.exitCode != null) throw new Error(`Disposable acceptance runtime exited with ${process.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for disposable acceptance runtime at ${url}.`);
}

function spawnRuntime(command: string, args: string[], env: RuntimeEnv) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: buildGate0OwnedChildProcessEnv(env),
    stdio: "pipe",
    detached: process.platform !== "win32",
  });
  if (process.env.WISEEFF_DISPOSABLE_RUNTIME_LOGS === "true") {
    child.stdout?.on("data", (chunk) => process.stdout.write(`[disposable] ${String(chunk)}`));
    child.stderr?.on("data", (chunk) => process.stderr.write(`[disposable] ${String(chunk)}`));
  }
  return child;
}

export function startTrackedNestedRuntimeProcess(input: {
  manifestPath: string;
  childId: string;
  process: "api" | "frontend";
  port: number;
  spawn(): ChildProcess;
  track(child: ChildProcess): void;
}) {
  const child = input.spawn();
  // Tracking precedes the manifest write so the local startup rollback owns the
  // child even when the atomic parent-manifest handshake itself fails.
  input.track(child);
  const pid = requireRuntimePid(child, input.process === "api" ? "API" : "frontend");
  const processIdentity = readProcessStartIdentity(pid);
  if (!processIdentity) {
    throw new Error(`Disposable ${input.process} process start identity could not be verified.`);
  }
  const identity = { pid, port: input.port, ...processIdentity };
  recordNestedRuntimeProgress(input.manifestPath, input.childId, input.process === "api"
    ? { apiPid: pid, apiProcessIdentity: identity }
    : { frontendPid: pid, frontendProcessIdentity: identity });
  return child;
}

async function stopRuntime(child: ChildProcess) {
  await stopOwnedProcessGroup(child, { terminateGraceMs: 3_000 });
}

export async function startDisposablePostCutoverRuntime(
  baseDatabaseUrl: string,
  options: StartDisposablePostCutoverRuntimeOptions = {},
): Promise<DisposablePostCutoverRuntime> {
  const purpose = options.markerPurpose ?? DEFAULT_DISPOSABLE_MARKER_PURPOSE;
  const databaseName = buildDisposableDatabaseName(options.label ?? "topology");
  const databaseUrl = databaseUrlFor(baseDatabaseUrl, databaseName);
  const adminUrl = adminDatabaseUrl(baseDatabaseUrl);
  const apiPort = options.apiPort ?? (await allocateLoopbackPort());
  const frontendPort = options.frontendPort ?? (await allocateLoopbackPort({
    min: 5_173,
    max: 5_199,
    excluded: new Set([apiPort]),
  }));
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const authIssuer = "wiseeff-disposable-acceptance";
  const authSecret = randomBytes(32).toString("hex");
  const generatedAuthorization = createDisposableAuthorization(authIssuer, authSecret);
  await registerGate0GeneratedSecrets([authSecret, generatedAuthorization]);
  const nestedManifestPath = process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV]?.trim();
  const objectStore = prepareNestedObjectStoreRoot(databaseName, nestedManifestPath);
  const objectStoreRoot = objectStore.root;
  const children: ChildProcess[] = [];
  let nestedRegistered = false;

  if (nestedManifestPath) {
    recordNestedRuntimeProvisioning(nestedManifestPath, {
      id: databaseName,
      databaseName,
      markerPurpose: purpose,
      objectStoreRoot,
      apiUrl,
      frontendUrl,
    });
    nestedRegistered = true;
  }

  try {
    await withClient(adminUrl, (client) => client.query(`create database ${databaseName}`));
    const migrationRunId = await preparePostCutoverDatabase(databaseUrl, purpose);
    await verifyPostCutoverDatabase(databaseUrl, migrationRunId, purpose);
    if (nestedManifestPath) {
      recordNestedRuntimeProgress(nestedManifestPath, databaseName, { migrationRunId });
    }

    const spawnApi = () => spawnRuntime("npm", ["run", "dev:api"], {
      DATABASE_URL: databaseUrl,
      PORT: String(apiPort),
      AUTH_MODE: "production",
      AUTH_PROVIDER: "hmac",
      AUTH_TOKEN_ISSUER: authIssuer,
      AUTH_TOKEN_HMAC_SECRET: authSecret,
      OBJECT_STORE_MODE: "local",
      OBJECT_STORE_ROOT: objectStoreRoot,
      XIAOZE_DETERMINISTIC: "true",
      [OWNED_ACCEPTANCE_DESCRIPTOR_ENV]: undefined,
      [OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV]: databaseName,
      ...(options.apiEnv ?? {}),
    });
    const api = nestedManifestPath
      ? startTrackedNestedRuntimeProcess({
          manifestPath: nestedManifestPath,
          childId: databaseName,
          process: "api",
          port: apiPort,
          spawn: spawnApi,
          track: (child) => { children.push(child); },
        })
      : spawnApi();
    if (!nestedManifestPath) children.push(api);
    await waitForHttp(`${apiUrl}/health/live`, api);

    const spawnFrontend = () => spawnRuntime(
      "npx",
      ["vite", "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"],
      {
        VITE_WISEEFF_RUNTIME_MODE: "api",
        VITE_WISEEFF_API_BASE_URL: apiUrl,
        [OWNED_ACCEPTANCE_DESCRIPTOR_ENV]: undefined,
        [OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV]: databaseName,
        ...(options.frontendEnv ?? {}),
      },
    );
    const frontend = nestedManifestPath
      ? startTrackedNestedRuntimeProcess({
          manifestPath: nestedManifestPath,
          childId: databaseName,
          process: "frontend",
          port: frontendPort,
          spawn: spawnFrontend,
          track: (child) => { children.push(child); },
        })
      : spawnFrontend();
    if (!nestedManifestPath) children.push(frontend);
    await waitForHttp(frontendUrl, frontend);

    if (nestedManifestPath) {
      recordNestedRuntimeProgress(nestedManifestPath, databaseName, {
        migrationRunId,
        apiPid: requireRuntimePid(api, "API"),
        frontendPid: requireRuntimePid(frontend, "frontend"),
        apiProcessIdentity: readRequiredProcessIdentity(api, apiPort, "API"),
        frontendProcessIdentity: readRequiredProcessIdentity(frontend, frontendPort, "frontend"),
        ready: true,
      });
    }

    return {
      databaseUrl,
      databaseName,
      migrationRunId,
      markerPurpose: purpose,
      apiUrl,
      frontendUrl,
      authIssuer,
      authSecret,
      nestedRuntimeId: nestedRegistered ? databaseName : undefined,
      async dispose(outcome = "success") {
        const result = await finalizeDisposableRuntimeResources({
          outcome,
          retainFailureResources: nestedRegistered,
          stopProcesses: () => stopAndReportNestedProcesses(children),
          async removeDatabase() {
            await verifyPostCutoverDatabase(databaseUrl, migrationRunId, purpose);
            await withClient(adminUrl, (client) =>
              client.query(`drop database if exists ${databaseName} with (force)`),
            );
          },
          removeObjectStore: () => removeNestedObjectStoreRoot(objectStore),
        });
        if (nestedManifestPath && nestedRegistered) {
          recordNestedRuntimeFinish(
            nestedManifestPath,
            databaseName,
            result.state,
            result.cleanup,
          );
        }
        if (result.errors.length > 0) {
          throw new AggregateError(result.errors, "Disposable nested runtime cleanup failed.");
        }
      },
    };
  } catch (error) {
    const cleanup: NestedRuntimeCleanup = nestedCleanupPending();
    const cleanupErrors: Error[] = [];
    await stopAndRecordNestedProcesses(children, cleanup, cleanupErrors);
    await afterNestedProcessesStop(cleanupErrors, async () => {
      await withClient(adminUrl, (client) =>
        client.query(`drop database if exists ${databaseName} with (force)`),
      ).then(
        () => { cleanup.database = { status: "removed" }; },
        (cleanupError) => {
          cleanup.database = { status: "failed", reason: safeNestedCleanupReason(cleanupError) };
          cleanupErrors.push(asNestedError(cleanupError));
        },
      );
      await removeNestedObjectStoreRoot(objectStore).then(
        () => { cleanup.objectStore = { status: "removed" }; },
        (cleanupError) => {
          cleanup.objectStore = { status: "failed", reason: safeNestedCleanupReason(cleanupError) };
          cleanupErrors.push(asNestedError(cleanupError));
        },
      );
    }, error);
    if (nestedManifestPath && nestedRegistered) {
      recordNestedRuntimeFinish(
        nestedManifestPath,
        databaseName,
        cleanupErrors.length === 0 ? "cleaned" : "cleanup-failed",
        cleanup,
      );
    }
    throw cleanupErrors.length === 0
      ? error
      : new AggregateError([asNestedError(error), ...cleanupErrors], "Disposable runtime startup and rollback failed.");
  }
}

function createDisposableAuthorization(issuer: string, secret: string) {
  const user = acceptanceCast.xuYun;
  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    sub: user.userId,
    org: organizationId,
    name: user.name,
    email: user.email,
    title: "Acceptance User",
    orgName: ACCEPTANCE_ORGANIZATION.name,
    roles: [],
    permissions: [],
    isActive: true,
    nbf: 0,
    exp: 9_999_999_999,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

export async function afterNestedProcessesStop<T>(
  processCleanupErrors: readonly Error[],
  cleanupResources: () => Promise<T>,
  primaryError?: unknown,
) {
  if (processCleanupErrors.length > 0) {
    const errors = primaryError === undefined
      ? [...processCleanupErrors]
      : [asNestedError(primaryError), ...processCleanupErrors];
    throw new AggregateError(
      errors,
      "Nested process cleanup did not settle; database and object store were retained for parent takeover.",
    );
  }
  return cleanupResources();
}

function nestedCleanupPending() {
  return {
    apiProcess: { status: "not-started" as const },
    frontendProcess: { status: "not-started" as const },
    database: { status: "retained" as const, reason: "Nested database cleanup did not complete." },
    objectStore: { status: "retained" as const, reason: "Nested object-store cleanup did not complete." },
  };
}

async function stopAndRecordNestedProcesses(
  children: ChildProcess[],
  cleanup: NestedRuntimeCleanup,
  errors: Error[],
) {
  for (const [label, child] of ([
    ["frontendProcess", children[1]],
    ["apiProcess", children[0]],
  ] as const)) {
    if (!child) continue;
    try {
      await stopRuntime(child);
      cleanup[label] = { status: "stopped" };
    } catch (error) {
      cleanup[label] = { status: "failed", reason: safeNestedCleanupReason(error) };
      errors.push(asNestedError(error));
    }
  }
}

async function stopAndReportNestedProcesses(children: ChildProcess[]): Promise<DisposableProcessCleanupResult> {
  const cleanup = nestedCleanupPending();
  const errors: Error[] = [];
  await stopAndRecordNestedProcesses(children, cleanup, errors);
  return {
    apiProcess: cleanup.apiProcess,
    frontendProcess: cleanup.frontendProcess,
    errors,
  };
}

function safeNestedCleanupReason(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/postgres(?:ql)?:\/\/[^\s"'\\]+/giu, "[REDACTED_DATABASE_URL]")
    .replace(/\bBearer\s+[-A-Za-z0-9._~+/=]{8,}/giu, "credential [REDACTED]")
    .replace(/authorization/giu, "credential-header")
    .replace(/auth.?secret/giu, "credential-secret");
}

function asNestedError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function requireRuntimePid(child: ChildProcess, label: string) {
  if (!child.pid) throw new Error(`Disposable ${label} runtime did not expose a PID.`);
  return child.pid;
}

function readRequiredProcessIdentity(child: ChildProcess, port: number, label: string) {
  const pid = requireRuntimePid(child, label);
  const identity = readProcessStartIdentity(pid);
  if (!identity) throw new Error(`Disposable ${label} process start identity could not be verified.`);
  return { pid, port, ...identity };
}
