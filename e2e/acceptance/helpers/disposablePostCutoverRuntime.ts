import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rm, readFile } from "node:fs/promises";
import { createServer } from "node:net";
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
  recordNestedRuntimeStart,
} from "./nestedRuntimeManifest";
import { OWNED_ACCEPTANCE_DESCRIPTOR_ENV } from "./ownedRuntimeDescriptor";

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
  dispose(): Promise<void>;
};

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

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "run";
}

export function buildDisposableDatabaseName(label: string) {
  const boundedLabel = safeSegment(label).slice(0, 12);
  return `${databasePrefix}${boundedLabel}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
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
    env: { ...process.env, ...env },
    stdio: "pipe",
    detached: process.platform !== "win32",
  });
  if (process.env.WISEEFF_DISPOSABLE_RUNTIME_LOGS === "true") {
    child.stdout?.on("data", (chunk) => process.stdout.write(`[disposable] ${String(chunk)}`));
    child.stderr?.on("data", (chunk) => process.stderr.write(`[disposable] ${String(chunk)}`));
  }
  return child;
}

async function stopRuntime(child: ChildProcess) {
  if (child.exitCode != null || !child.pid) return;
  const signal = (name: NodeJS.Signals) => {
    try {
      if (process.platform === "win32") child.kill(name);
      else process.kill(-child.pid!, name);
    } catch {
      // Process already stopped.
    }
  };
  signal("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode == null) signal("SIGKILL");
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
  const objectStoreRoot = path.resolve("work", "disposable-acceptance-object-store", databaseName);
  const nestedManifestPath = process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV]?.trim();
  const children: ChildProcess[] = [];
  let nestedRegistered = false;

  await withClient(adminUrl, (client) => client.query(`create database ${databaseName}`));
  try {
    const migrationRunId = await preparePostCutoverDatabase(databaseUrl, purpose);
    await verifyPostCutoverDatabase(databaseUrl, migrationRunId, purpose);

    const api = spawnRuntime("npm", ["run", "dev:api"], {
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
    children.push(api);
    await waitForHttp(`${apiUrl}/health/live`, api);

    const frontend = spawnRuntime(
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
    children.push(frontend);
    await waitForHttp(frontendUrl, frontend);

    if (nestedManifestPath) {
      recordNestedRuntimeStart(nestedManifestPath, {
        id: databaseName,
        databaseName,
        markerPurpose: purpose,
        migrationRunId,
        objectStoreRoot,
        apiUrl,
        frontendUrl,
        apiPid: requireRuntimePid(api, "API"),
        frontendPid: requireRuntimePid(frontend, "frontend"),
      });
      nestedRegistered = true;
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
      async dispose() {
        try {
          await Promise.all(children.reverse().map(stopRuntime));
          await verifyPostCutoverDatabase(databaseUrl, migrationRunId, purpose);
          await withClient(adminUrl, (client) =>
            client.query(`drop database if exists ${databaseName} with (force)`),
          );
          await rm(objectStoreRoot, { recursive: true, force: true });
          if (nestedManifestPath && nestedRegistered) {
            recordNestedRuntimeFinish(nestedManifestPath, databaseName, "cleaned");
          }
        } catch (error) {
          if (nestedManifestPath && nestedRegistered) {
            recordNestedRuntimeFinish(nestedManifestPath, databaseName, "cleanup-failed");
          }
          throw error;
        }
      },
    };
  } catch (error) {
    await Promise.all(children.reverse().map(stopRuntime));
    const databaseCleanup = await withClient(adminUrl, (client) =>
      client.query(`drop database if exists ${databaseName} with (force)`),
    ).then(() => true, () => false);
    const objectCleanup = await rm(objectStoreRoot, { recursive: true, force: true }).then(
      () => true,
      () => false,
    );
    if (nestedManifestPath && nestedRegistered) {
      recordNestedRuntimeFinish(
        nestedManifestPath,
        databaseName,
        databaseCleanup && objectCleanup ? "failed-cleaned" : "cleanup-failed",
      );
    }
    throw error;
  }
}

function requireRuntimePid(child: ChildProcess, label: string) {
  if (!child.pid) throw new Error(`Disposable ${label} runtime did not expose a PID.`);
  return child.pid;
}
