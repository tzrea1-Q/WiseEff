import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../shared/database/client";
import { applyMigrations, getPendingMigrations } from "../../shared/database/migrations";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationsDir = path.join(projectRoot, "server", "migrations");
const migration0048 = "0048_parameter_topology_schema_shadow.sql";
const migration0060 = "0060_parameter_draft_candidate_identity_gate.sql";
const migration0061 = "0061_parameter_draft_candidate_identity_all_origins.sql";
const migration0062 = "0062_parameter_change_action.sql";
const migration0063 = "0063_parameter_submission_candidate_identity.sql";
const migration0066 = "0066_parameter_module_mappings.sql";
const migration0067 = "0067_binding_module_id.sql";

const REQUIRED_TABLES = [
  "parameter_specs",
  "parameter_spec_versions",
  "driver_schemas",
  "driver_schema_versions",
  "dts_property_specs",
  "parameter_policy_targets",
  "business_categories",
  "dts_config_revisions",
  "dts_config_revision_members",
  "dts_node_occurrences",
  "dts_property_occurrences",
  "dts_logical_nodes",
  "dts_logical_node_revisions",
  "dts_occurrence_effects",
  "project_parameter_bindings",
  "project_parameter_binding_revisions",
  "identity_mapping_tasks",
  "parameter_spec_review_tasks",
  "parameter_spec_matcher_overrides",
  "dts_property_occurrence_spec_decisions",
  "dts_validation_runs",
  "dts_validation_diagnostics",
  "audit_subject_links",
  "legacy_parameter_migration_evidence",
  "parameter_draft_identity_invalidations"
] as const;

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

async function listPublicTables(db: Database): Promise<string[]> {
  const result = await db.query<{ table_name: string }>(
    `select table_name
     from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`
  );
  return result.rows.map((row) => row.table_name);
}

async function columnExists(db: Database, table: string, column: string): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `select exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = $1
         and column_name = $2
     ) as exists`,
    [table, column]
  );
  return Boolean(result.rows[0]?.exists);
}

async function columnDefinition(db: Database, table: string, column: string) {
  const result = await db.query<{ is_nullable: string; column_default: string | null }>(
    `select is_nullable, column_default
     from information_schema.columns
     where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column]
  );
  return result.rows[0] ?? null;
}

async function hasActionCheck(db: Database, table: string): Promise<boolean> {
  const result = await db.query<{ present: boolean }>(
    `select exists (
       select 1
       from pg_constraint c
       inner join pg_class rel on rel.oid = c.conrelid
       inner join pg_namespace nsp on nsp.oid = rel.relnamespace
       where nsp.nspname = 'public'
         and rel.relname = $1
         and c.contype = 'c'
         and pg_get_constraintdef(c.oid) ilike '%action%set%delete%'
     ) as present`,
    [table]
  );
  return Boolean(result.rows[0]?.present);
}

async function exampleValueHasEnforcingConstraint(db: Database): Promise<boolean> {
  const result = await db.query<{ conname: string }>(
    `select c.conname
     from pg_constraint c
     join pg_class rel on rel.oid = c.conrelid
     join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'parameter_spec_versions'
       and pg_get_constraintdef(c.oid) ilike '%example_value%'`
  );
  return result.rows.length > 0;
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

async function withTempDatabase(fn: (db: Database, connectionString: string) => Promise<void>) {
  const dbName = `wiseeff_schema_mig_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`.replace(
    /[^a-z0-9_]/gi,
    ""
  );
  await withAdminClient(async (admin) => {
    await admin.query(`create database ${dbName}`);
  });

  const connectionString = adminConnectionString(dbName);
  const client = new pg.Client({ connectionString });
  await client.connect();
  const db = createDatabase({
    query: async (text, values = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  });

  try {
    await fn(db, connectionString);
  } finally {
    await client.end().catch(() => undefined);
    await withAdminClient(async (admin) => {
      await admin.query(`drop database if exists ${dbName} with (force)`);
    });
  }
}

async function applyMigrationsThrough(
  db: Database,
  maxExclusive: string | null
): Promise<string[]> {
  await db.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const limited = maxExclusive ? files.filter((file) => file < maxExclusive) : files;
  const applied = await db.query<{ name: string }>("select name from schema_migrations order by name");
  const pending = getPendingMigrations(
    limited,
    applied.rows.map((row) => row.name)
  );

  for (const file of pending) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await db.query("begin");
    try {
      await db.query(sql);
      await db.query("insert into schema_migrations (name) values ($1)", [file]);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  }

  return pending;
}

describe.skipIf(!databaseAvailable)("0048 parameter topology schema shadow", () => {
  beforeAll(() => {
    expect(databaseAvailable).toBe(true);
  });

  afterAll(async () => {
    // Temp databases are dropped per test; no shared fixture cleanup.
  });

  it("creates semantic shadow tables when migrations are applied twice on a fresh database", async () => {
    await withTempDatabase(async (db) => {
      const first = await applyMigrations(db, migrationsDir);
      expect(first).toContain(migration0048);

      const second = await applyMigrations(db, migrationsDir);
      expect(second).toEqual([]);

      const tableNames = await listPublicTables(db);
      expect(tableNames).toEqual(expect.arrayContaining([...REQUIRED_TABLES]));

      expect(await columnExists(db, "parameter_history_entries", "parameter_spec_id")).toBe(true);
      expect(await columnExists(db, "parameter_history_entries", "project_parameter_binding_id")).toBe(
        true
      );
      expect(await columnExists(db, "parameter_drafts", "project_parameter_binding_id")).toBe(true);
      expect(await columnExists(db, "parameter_drafts", "candidate_config_revision_id")).toBe(true);
      expect(await columnExists(db, "parameter_change_requests", "parameter_spec_id")).toBe(true);
      expect(await columnExists(db, "parameter_change_requests", "project_parameter_binding_id")).toBe(
        true
      );
      expect(await columnExists(db, "parameter_change_requests", "candidate_config_revision_id")).toBe(
        true
      );
      expect(await columnExists(db, "parameter_submission_items", "project_parameter_binding_id")).toBe(
        true
      );
      expect(await columnExists(db, "parameter_submission_items", "candidate_config_revision_id")).toBe(
        true
      );
      expect(await columnExists(db, "parameter_file_sync_conflicts", "parameter_spec_id")).toBe(true);
      expect(
        await columnExists(db, "parameter_file_sync_conflicts", "project_parameter_binding_id")
      ).toBe(true);
      expect(await columnExists(db, "debugging_parameters", "parameter_spec_id")).toBe(true);
      expect(await columnExists(db, "debugging_parameters", "project_parameter_binding_id")).toBe(true);
      expect(await columnExists(db, "node_operations", "parameter_spec_id")).toBe(true);
      expect(await columnExists(db, "node_operations", "project_parameter_binding_id")).toBe(true);

      expect(await columnExists(db, "parameter_spec_versions", "example_value")).toBe(true);
      expect(await exampleValueHasEnforcingConstraint(db)).toBe(false);

      // Legacy identity columns remain for the additive shadow phase.
      expect(await columnExists(db, "parameter_history_entries", "parameter_definition_id")).toBe(true);
      expect(await columnExists(db, "debugging_parameters", "parameter_definition_id")).toBe(true);
    });
  });

  it("applies 0048 on a database already at 0047", async () => {
    await withTempDatabase(async (db) => {
      const through0047 = await applyMigrationsThrough(db, migration0048);
      expect(through0047.at(-1)).toBe("0047_dts_phandle_target_on_delete.sql");

      const before = await listPublicTables(db);
      expect(before).not.toContain("parameter_specs");

      const pending = await applyMigrations(db, migrationsDir);
      expect(pending[0]).toBe(migration0048);
      expect(pending).toEqual(
        expect.arrayContaining([migration0048, "0049_parameter_identity_migration_infra.sql"])
      );

      const tableNames = await listPublicTables(db);
      expect(tableNames).toEqual(expect.arrayContaining([...REQUIRED_TABLES]));

      const again = await applyMigrations(db, migrationsDir);
      expect(again).toEqual([]);
    });
  });

  it("invalidates pre-0060 manual drafts without candidate identity transactionally and idempotently", async () => {
    await withTempDatabase(async (db) => {
      await applyMigrationsThrough(db, migration0060);
      await db.query(`insert into organizations (id, name) values ('org-0060', 'Org 0060')`);
      await db.query(
        `insert into users (id, organization_id, name, email, title)
         values
           ('user-0060', 'org-0060', 'User 0060', 'user-0060@example.com', 'Engineer'),
           ('user-0060-semantic', 'org-0060', 'Semantic User 0060', 'user-0060-semantic@example.com', 'Engineer')`
      );
      await db.query(
        `insert into projects (id, organization_id, name, code)
         values ('project-0060', 'org-0060', 'Project 0060', 'P0060')`
      );
      await db.query(
        `insert into parameter_definitions (
           id, organization_id, name, description, explanation, config_format,
           module, default_range, unit, risk
         ) values (
           'definition-0060', 'org-0060', 'gpio_int', 'desc', 'explain', 'DTS',
           'manual', 'n/a', '', 'Medium'
         )`
      );
      await db.query(
        `insert into project_parameter_values (
           id, organization_id, project_id, parameter_definition_id,
           current_value, recommended_value, updated_by_user_id
         ) values (
           'ppv-0060', 'org-0060', 'project-0060', 'definition-0060',
           '<&gpio13 29 0>', '', 'user-0060'
         )`
      );
      await db.query(
        `insert into parameter_specs (id, organization_id, source_kind, specification_key)
         values ('spec-0060', 'org-0060', 'manual', 'manual/gpio-int-0060')`
      );
      await db.query(
        `insert into project_parameter_bindings (
           id, organization_id, project_id, logical_node_id, parameter_spec_id
         ) values ('binding-0060', 'org-0060', 'project-0060', null, 'spec-0060')`
      );
      await db.query(
        `insert into parameter_drafts (
           id, organization_id, project_id, project_parameter_value_id, user_id,
           target_value, reason, origin, project_parameter_binding_id,
           candidate_config_revision_id
         ) values
           ('draft-0060-legacy', 'org-0060', 'project-0060', 'ppv-0060', 'user-0060',
            '<&gpio13 30 0>', 'legacy draft', 'manual', null, null),
           ('draft-0060-semantic', 'org-0060', 'project-0060', 'ppv-0060', 'user-0060-semantic',
            '<&gpio13 31 0>', 'semantic draft', 'manual', 'binding-0060', null)`
      );

      const migrationSql = await fs.readFile(path.join(migrationsDir, migration0060), "utf8");
      await db.query("begin");
      await expect(
        (async () => {
          await db.query(migrationSql);
          await db.query("select * from deliberate_0060_failure");
        })()
      ).rejects.toBeTruthy();
      await db.query("rollback");
      expect((await db.query(`select id from parameter_drafts order by id`)).rows).toHaveLength(2);
      expect(await columnExists(db, "parameter_draft_identity_invalidations", "draft_id")).toBe(false);

      const pending = await applyMigrations(db, migrationsDir);
      expect(pending).toEqual([
        migration0060,
        migration0061,
        migration0062,
        migration0063,
        migration0066,
        migration0067
      ]);
      expect((await db.query(`select id from parameter_drafts order by id`)).rows).toEqual([]);
      expect(
        (
          await db.query<{
            draft_id: string;
            project_parameter_binding_id: string | null;
            invalidation_reason: string;
          }>(
            `select draft_id, project_parameter_binding_id, invalidation_reason
             from parameter_draft_identity_invalidations order by draft_id`
          )
        ).rows
      ).toEqual([
        {
          draft_id: "draft-0060-legacy",
          project_parameter_binding_id: null,
          invalidation_reason: "missing-candidate-config-revision"
        },
        {
          draft_id: "draft-0060-semantic",
          project_parameter_binding_id: "binding-0060",
          invalidation_reason: "missing-candidate-config-revision"
        }
      ]);
      expect(await applyMigrations(db, migrationsDir)).toEqual([]);
    });
  });

  it("invalidates every candidate-less draft after 0060, including file_sync conflict rows", async () => {
    await withTempDatabase(async (db) => {
      await applyMigrationsThrough(db, migration0061);
      await db.query(`insert into organizations (id, name) values ('org-0061', 'Org 0061')`);
      await db.query(
        `insert into users (id, organization_id, name, email, title)
         values
           ('user-0061-manual', 'org-0061', 'Manual 0061', 'manual-0061@example.com', 'Engineer'),
           ('user-0061-file', 'org-0061', 'File 0061', 'file-0061@example.com', 'Engineer'),
           ('user-0061-ui', 'org-0061', 'UI 0061', 'ui-0061@example.com', 'Engineer'),
           ('user-0061-valid', 'org-0061', 'Valid 0061', 'valid-0061@example.com', 'Engineer')`
      );
      await db.query(
        `insert into projects (id, organization_id, name, code)
         values ('project-0061', 'org-0061', 'Project 0061', 'P0061')`
      );
      await db.query(
        `insert into parameter_definitions (
           id, organization_id, name, description, explanation, config_format,
           module, default_range, unit, risk
         ) values (
           'definition-0061', 'org-0061', 'gpio_int', 'desc', 'explain', 'DTS',
           'manual', 'n/a', '', 'Medium'
         )`
      );
      await db.query(
        `insert into project_parameter_values (
           id, organization_id, project_id, parameter_definition_id,
           current_value, recommended_value, updated_by_user_id
         ) values (
           'ppv-0061', 'org-0061', 'project-0061', 'definition-0061',
           '<&gpio13 29 0>', '', 'user-0061-manual'
         )`
      );
      await db.query(
        `insert into parameter_specs (id, organization_id, source_kind, specification_key)
         values ('spec-0061', 'org-0061', 'manual', 'manual/gpio-int-0061')`
      );
      await db.query(
        `insert into project_parameter_bindings (
           id, organization_id, project_id, logical_node_id, parameter_spec_id
         ) values ('binding-0061', 'org-0061', 'project-0061', null, 'spec-0061')`
      );
      await db.query(
        `insert into dts_config_set (id, organization_id, project_id, name)
         values ('config-set-0061', 'org-0061', 'project-0061', 'Config 0061')`
      );
      await db.query(
        `insert into dts_config_revisions (
           id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
         ) values (
           'candidate-0061', 'org-0061', 'project-0061', 'config-set-0061', 1, 'draft', 'user-0061-valid'
         )`
      );
      await db.query(
        `insert into project_parameter_files (
           id, organization_id, project_id, file_name, format
         ) values ('file-0061', 'org-0061', 'project-0061', 'board.dts', 'dts')`
      );
      await db.query(
        `insert into project_parameter_file_versions (
           id, file_id, version_number, storage_key, checksum, size_bytes, origin, created_by_user_id
         ) values (
           'file-version-0061', 'file-0061', 1, 'test/0061-board.dts', 'checksum-0061', 1,
           'upload', 'user-0061-file'
         )`
      );
      await db.query(
        `insert into parameter_drafts (
           id, organization_id, project_id, project_parameter_value_id, user_id,
           target_value, reason, origin, origin_file_version_id,
           project_parameter_binding_id, candidate_config_revision_id
         ) values
           ('draft-0061-manual', 'org-0061', 'project-0061', 'ppv-0061', 'user-0061-manual',
            '<&gpio13 30 0>', 'manual without candidate', 'manual', null, 'binding-0061', null),
           ('draft-0061-file', 'org-0061', 'project-0061', 'ppv-0061', 'user-0061-file',
            '<&gpio13 31 0>', 'resolved file conflict', 'file_sync', 'file-version-0061', 'binding-0061', null),
           ('draft-0061-ui', 'org-0061', 'project-0061', 'ppv-0061', 'user-0061-ui',
            '<&gpio13 32 0>', 'conflicting ui draft', 'manual', null, 'binding-0061', null),
           ('draft-0061-valid', 'org-0061', 'project-0061', 'ppv-0061', 'user-0061-valid',
            '<&gpio13 33 0>', 'candidate-backed draft', 'manual', null, 'binding-0061', 'candidate-0061')`
      );
      await db.query(
        `insert into parameter_file_sync_conflicts (
           id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
           file_version_id, file_draft_id, ui_draft_id, file_value, ui_draft_value,
           status, resolved_by_user_id, resolved_at, parameter_spec_id, project_parameter_binding_id
         ) values (
           'conflict-0061', 'org-0061', 'project-0061', 'ppv-0061', 'definition-0061',
           'file-version-0061', 'draft-0061-file', 'draft-0061-ui', '<&gpio13 31 0>', '<&gpio13 32 0>',
           'resolved_file', 'user-0061-manual', now(), 'spec-0061', 'binding-0061'
         )`
      );

      const migrationSql = await fs.readFile(path.join(migrationsDir, migration0061), "utf8");
      await db.query("begin");
      await expect(
        (async () => {
          await db.query(migrationSql);
          await db.query("select * from deliberate_0061_failure");
        })()
      ).rejects.toBeTruthy();
      await db.query("rollback");
      expect((await db.query(`select id from parameter_drafts order by id`)).rows).toHaveLength(4);
      expect((await db.query(`select id from parameter_file_sync_conflicts`)).rows).toHaveLength(1);
      expect((await db.query(`select draft_id from parameter_draft_identity_invalidations`)).rows).toEqual([]);
      expect(await columnExists(db, "parameter_draft_identity_invalidations", "draft_origin")).toBe(false);

      const pending = await applyMigrations(db, migrationsDir);
      expect(pending).toEqual([
        migration0061,
        migration0062,
        migration0063,
        migration0066,
        migration0067
      ]);
      expect((await db.query(`select id from parameter_drafts order by id`)).rows).toEqual([
        { id: "draft-0061-valid" }
      ]);
      expect((await db.query(`select id from parameter_file_sync_conflicts`)).rows).toEqual([]);
      expect(
        (
          await db.query<{
            draft_id: string;
            project_parameter_binding_id: string | null;
            invalidation_reason: string;
            draft_origin: string | null;
            origin_file_version_id: string | null;
          }>(
            `select draft_id, project_parameter_binding_id, invalidation_reason,
                    draft_origin, origin_file_version_id
             from parameter_draft_identity_invalidations order by draft_id`
          )
        ).rows
      ).toEqual([
        {
          draft_id: "draft-0061-file",
          project_parameter_binding_id: "binding-0061",
          invalidation_reason: "missing-candidate-config-revision",
          draft_origin: "file_sync",
          origin_file_version_id: "file-version-0061"
        },
        {
          draft_id: "draft-0061-manual",
          project_parameter_binding_id: "binding-0061",
          invalidation_reason: "missing-candidate-config-revision",
          draft_origin: "manual",
          origin_file_version_id: null
        },
        {
          draft_id: "draft-0061-ui",
          project_parameter_binding_id: "binding-0061",
          invalidation_reason: "missing-candidate-config-revision",
          draft_origin: "manual",
          origin_file_version_id: null
        }
      ]);
      expect(await applyMigrations(db, migrationsDir)).toEqual([]);
    });
  });

  it("adds durable set/delete action columns with fail-closed defaults and checks", async () => {
    await withTempDatabase(async (db) => {
      await applyMigrationsThrough(db, migration0062);
      for (const table of ["parameter_drafts", "parameter_submission_items", "parameter_change_requests"]) {
        expect(await columnExists(db, table, "action")).toBe(false);
      }

      const pending = await applyMigrations(db, migrationsDir);
      expect(pending).toEqual([migration0062, migration0063, migration0066, migration0067]);

      for (const table of ["parameter_drafts", "parameter_submission_items", "parameter_change_requests"]) {
        expect(await columnDefinition(db, table, "action")).toEqual({
          is_nullable: "NO",
          column_default: "'set'::text"
        });
        expect(await hasActionCheck(db, table)).toBe(true);
      }
      expect(await applyMigrations(db, migrationsDir)).toEqual([]);
    });
  });

  it("adds durable candidate identity to submitted workflow rows transactionally and idempotently", async () => {
    await withTempDatabase(async (db) => {
      await applyMigrationsThrough(db, migration0063);
      for (const table of ["parameter_submission_items", "parameter_change_requests"]) {
        expect(await columnExists(db, table, "candidate_config_revision_id")).toBe(false);
      }

      const migrationSql = await fs.readFile(path.join(migrationsDir, migration0063), "utf8");
      await db.query("begin");
      await expect(
        (async () => {
          await db.query(migrationSql);
          await db.query("select * from deliberate_0063_failure");
        })()
      ).rejects.toBeTruthy();
      await db.query("rollback");
      for (const table of ["parameter_submission_items", "parameter_change_requests"]) {
        expect(await columnExists(db, table, "candidate_config_revision_id")).toBe(false);
      }

      expect(await applyMigrations(db, migrationsDir)).toEqual([
        migration0063,
        migration0066,
        migration0067
      ]);
      for (const table of ["parameter_submission_items", "parameter_change_requests"]) {
        expect(await columnDefinition(db, table, "candidate_config_revision_id")).toEqual({
          is_nullable: "YES",
          column_default: null
        });
      }
      expect(await applyMigrations(db, migrationsDir)).toEqual([]);
    });
  });
});
