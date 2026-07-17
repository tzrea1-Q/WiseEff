import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
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

const databasePrefix = "wiseeff_acceptance_disposable_";
const markerPurpose = "parameter-topology";
const organizationId = "org-chargelab";
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
  apiUrl: string;
  frontendUrl: string;
  authIssuer: string;
  authSecret: string;
  dispose(): Promise<void>;
};

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "run";
}

export function buildDisposableDatabaseName(label: string) {
  const boundedLabel = safeSegment(label).slice(0, 12);
  return `${databasePrefix}${boundedLabel}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

export function assertDisposableDatabaseIdentity(identity: DisposableDatabaseIdentity) {
  if (!identity.databaseName.startsWith(databasePrefix)) {
    throw new Error(`Refusing destructive acceptance cleanup: invalid disposable database name ${identity.databaseName}.`);
  }
  if (identity.markerPurpose !== markerPurpose) {
    throw new Error("Refusing disposable database use: missing parameter-topology test-only marker.");
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
  const users = [
    ["u-xu-yun", "Xu Yun", "xu@chargelab.cn", "Platform Owner"],
    ["u-zhao-heng", "Zhao Heng", "zhao@chargelab.cn", "Hardware Engineer"],
    ["u-liu-min", "Liu Min", "liu@chargelab.cn", "Software Engineer"],
    ["u-wang-jie", "Wang Jie", "wang@chargelab.cn", "Hardware Reviewer"],
    ["u-chen-na", "Chen Na", "chen@chargelab.cn", "Software Integrator"],
    ["u-li-peng", "Li Peng", "lipeng@chargelab.cn", "Hardware Committer"],
    ["u-sun-mei", "Sun Mei", "sun@chargelab.cn", "Software Reviewer"],
  ] as const;
  for (const [id, name, email, title] of users) {
    await db.query(
      `insert into users (id, organization_id, name, email, title, is_active)
       values ($1, $2, $3, $4, $5, true)`,
      [id, organizationId, name, email, title],
    );
  }
  await seedBaselinePlatformRoles(db);
  await db.query(
    `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
     values ('urb-disposable-admin', 'u-xu-yun', $1, null, 'admin')`,
    [organizationId],
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Aurora disposable topology acceptance', 'AURORA', 'initialized')`,
    [projectId, organizationId],
  );
  const bindings = [
    ["u-wang-jie", "hardware-committer"],
    ["u-li-peng", "hardware-committer"],
    ["u-sun-mei", "software-committer"],
    ["u-liu-min", "software-user"],
    ["u-chen-na", "software-user"],
  ] as const;
  for (const [userId, roleId] of bindings) {
    await db.query(
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
       values ($1, $2, $3, $4, $5)`,
      [`urb-disposable-${userId}-${roleId}`, userId, organizationId, projectId, roleId],
    );
  }
}

async function preparePostCutoverDatabase(databaseUrl: string) {
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
    await db.query(
      `create table wiseeff_acceptance_test_markers (
         purpose text primary key,
         migration_run_id text not null,
         created_at timestamptz not null default now()
       )`,
    );
    await db.query(
      `insert into wiseeff_acceptance_test_markers (purpose, migration_run_id) values ($1, $2)`,
      [markerPurpose, report.migrationRunId],
    );
    return report.migrationRunId;
  });
}

async function verifyPostCutoverDatabase(databaseUrl: string, expectedMigrationRunId: string) {
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
      [markerPurpose],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Disposable acceptance marker or matching cutover is missing.");
    assertDisposableDatabaseIdentity({
      databaseName: row.database_name,
      markerPurpose: row.purpose,
      markerMigrationRunId: row.marker_migration_run_id,
      cutoverMigrationRunId: row.cutover_migration_run_id,
      expectedMigrationRunId,
    });
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
  options: { label?: string; apiPort?: number; frontendPort?: number } = {},
): Promise<DisposablePostCutoverRuntime> {
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
  const children: ChildProcess[] = [];

  await withClient(adminUrl, (client) => client.query(`create database ${databaseName}`));
  try {
    const migrationRunId = await preparePostCutoverDatabase(databaseUrl);
    await verifyPostCutoverDatabase(databaseUrl, migrationRunId);

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
    });
    children.push(api);
    await waitForHttp(`${apiUrl}/health/live`, api);

    const frontend = spawnRuntime(
      "npx",
      ["vite", "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"],
      {
        VITE_WISEEFF_RUNTIME_MODE: "api",
        VITE_WISEEFF_API_BASE_URL: apiUrl,
      },
    );
    children.push(frontend);
    await waitForHttp(frontendUrl, frontend);

    return {
      databaseUrl,
      databaseName,
      migrationRunId,
      apiUrl,
      frontendUrl,
      authIssuer,
      authSecret,
      async dispose() {
        await Promise.all(children.reverse().map(stopRuntime));
        await verifyPostCutoverDatabase(databaseUrl, migrationRunId);
        await withClient(adminUrl, (client) =>
          client.query(`drop database if exists ${databaseName} with (force)`),
        );
        await rm(objectStoreRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await Promise.all(children.reverse().map(stopRuntime));
    await withClient(adminUrl, (client) =>
      client.query(`drop database if exists ${databaseName} with (force)`),
    ).catch(() => undefined);
    await rm(objectStoreRoot, { recursive: true, force: true });
    throw error;
  }
}
