/**
 * Manual file sync is a write path: it upserts file-sync drafts and opens file<->ui conflicts.
 * The API contract promises `parameter-file-sync` and `parameter-file-conflict-open` audit
 * actions, but syncFileVersion emitted neither. This asserts both are now written.
 */
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import type { AuthContext } from "../auth/types";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { syncFileVersion } from "./syncService";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationsDir = path.join(projectRoot, "server", "migrations");

const ORG = "org-sync-audit";
const USER = "user-sync-audit";
const OTHER_USER = "user2-sync-audit";
const PROJECT = "project-sync-audit";
const CONFIG_SET = "dcs-sync-audit";
const DEF = "pd-sync-audit";
const PPV = "ppv-sync-audit";
const FILE = "file-sync-audit";
const VERSION = "fv-sync-audit";
const FILE_NAME = "sync-audit.dts";
const NODE_PATH = "amba/i2c@FDF5E000/sc8562@6E/gpio_int";

const databaseAvailable = await isTestDatabaseAvailable();

function resolveTestDatabaseUrl() {
  return (
    process.env.TEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff"
  );
}
function adminConnectionString(database = "postgres") {
  const url = new URL(resolveTestDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}
async function withAdminClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminConnectionString("postgres") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
async function withTempDatabase(fn: (db: Database) => Promise<void>) {
  const dbName = `wiseeff_sa_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`.replace(/[^a-z0-9_]/gi, "");
  await withAdminClient(async (admin) => {
    await admin.query(`create database ${dbName}`);
  });
  const client = new pg.Client({ connectionString: adminConnectionString(dbName) });
  await client.connect();
  const db = createDatabase({
    query: async (text, values = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  });
  try {
    await applyMigrations(db, migrationsDir);
    await fn(db);
  } finally {
    await client.end().catch(() => undefined);
    await withAdminClient(async (admin) => {
      await admin.query(`drop database if exists ${dbName} with (force)`);
    });
  }
}

function makeAuth(): AuthContext {
  return {
    user: { id: USER, organizationId: ORG, name: "Sync Audit", email: "sa@example.com", title: "Admin", isActive: true },
    organization: { id: ORG, name: "Sync Audit Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"]
  };
}

async function seedLegacySyncableFile(db: Database) {
  await db.query(`insert into organizations (id, name) values ($1, 'Sync Audit Org')`, [ORG]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Sync Audit', 'sa@example.com', 'Admin', true)`,
    [USER, ORG]
  );
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Other Editor', 'other@example.com', 'Engineer', true)`,
    [OTHER_USER, ORG]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Sync Audit Project', 'SA', 'initialized')`,
    [PROJECT, ORG]
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name, description)
     values ($1, $2, $3, 'sa', 'sa')`,
    [CONFIG_SET, ORG, PROJECT]
  );
  await db.query(
    `insert into parameter_definitions (id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk)
     values ($1, $2, 'gpio_int', 'GPIO interrupt', 'legacy', 'DTS', 'sc8562', '', '', 'Low')`,
    [DEF, ORG]
  );
  await db.query(
    `insert into project_parameter_values (
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version, updated_by_user_id, source_file_name, source_node_path
    ) values ($1, $2, $3, $4, '<1>', '', 1, $5, $6, $7)`,
    [PPV, ORG, PROJECT, DEF, USER, FILE_NAME, NODE_PATH]
  );
  await db.query(
    `insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled, config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, $4, 'dts', true, $5, 'base', 0)`,
    [FILE, ORG, PROJECT, FILE_NAME, CONFIG_SET]
  );
  const content = `gpio_int = <2>;`;
  const checksum = createHash("sha256").update(content, "utf8").digest("hex");
  await db.query(
    `insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, $6::jsonb, 'upload', $7)`,
    [
      VERSION,
      FILE,
      `${ORG}/${checksum}-${FILE_NAME}`,
      checksum,
      Buffer.byteLength(content),
      JSON.stringify({ [NODE_PATH]: { value: "<2>" } }),
      USER
    ]
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [VERSION, FILE]);
  // Another editor's conflicting manual UI draft (different value, distinct
  // (project, ppv, user) key) so the sync opens a file<->ui conflict.
  await db.query(
    `insert into parameter_drafts (id, organization_id, project_id, project_parameter_value_id, user_id, target_value, reason, origin)
     values ($1, $2, $3, $4, $5, '<3>', 'ui edit', 'manual')`,
    [`draft-manual-${randomUUID()}`, ORG, PROJECT, PPV, OTHER_USER]
  );
}

async function auditKinds(db: Database) {
  const result = await db.query<{ kind: string; target_id: string; trace_id: string }>(
    `select kind, target_id, trace_id from audit_events where organization_id = $1 order by kind`,
    [ORG]
  );
  return result.rows;
}

describe.skipIf(!databaseAvailable)("manual file sync audit (parameter-file-sync / conflict-open)", () => {
  beforeEach(() => setParameterIdentityMode("legacy"));
  afterEach(() => setParameterIdentityMode(null));

  it("writes parameter-file-sync and parameter-file-conflict-open audit events", async () => {
    await withTempDatabase(async (db) => {
      await seedLegacySyncableFile(db);

      const summary = await syncFileVersion(
        db,
        makeAuth(),
        { fileId: FILE, versionId: VERSION },
        { requestId: "req-sync-audit" }
      );
      expect(summary.skipped).toBe(false);
      expect(summary.draftsCreated).toBe(1);

      const audits = await auditKinds(db);
      const sync = audits.filter((row) => row.kind === "parameter-file-sync");
      const open = audits.filter((row) => row.kind === "parameter-file-conflict-open");

      expect(sync).toHaveLength(1);
      expect(sync[0]?.target_id).toBe(FILE);
      expect(sync[0]?.trace_id).toBe("req-sync-audit");
      expect(open).toHaveLength(1);
      expect(open[0]?.trace_id).toBe("req-sync-audit");
    });
  }, 120_000);
});
