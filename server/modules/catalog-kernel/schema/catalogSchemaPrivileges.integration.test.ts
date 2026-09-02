import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../../../shared/database/migrations";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
} from "../../../testing/testDatabase";
import { migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import type { Database } from "../../../shared/database/client";

const databaseAvailable = await isTestDatabaseAvailable();
const floorMigration = "0136_parameter_execution_principal_deleted_marker.sql";
const catalogMigration = "0137_canonical_parameter_catalog_schema.sql";

if (!databaseAvailable) {
  throw new Error(
    "S2-SCH privilege and migration tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = databaseAvailable
  ? await (async () => {
      const probe = await createInMemoryTestDatabase();
      try {
        const result = await probe.query<{ installed: boolean }>(
          `select exists (
             select 1
             from pg_catalog.pg_extension
             where extname = 'vector'
           ) as installed`,
        );
        return result.rows[0]?.installed === true;
      } finally {
        await probe.rollback();
      }
    })()
  : false;

if (!pgVectorInstalled) {
  throw new Error(
    "S2-SCH privilege and migration tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

async function canonicalSchemaFingerprint(db: Database): Promise<string> {
  const [relations, columns, constraints, indexes, triggers, functions] =
    await Promise.all([
      db.query<{
        relation_name: string;
        relation_kind: string;
      }>(`
      select class.relname as relation_name, class.relkind::text as relation_kind
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'parameter_catalog'
        and class.relkind in ('r', 'p', 'S')
      order by class.relname
    `),
      db.query<{
        relation_name: string;
        ordinal: number;
        column_name: string;
        data_type: string;
        not_null: boolean;
        default_expression: string | null;
      }>(`
      select
        class.relname as relation_name,
        attribute.attnum as ordinal,
        attribute.attname as column_name,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as data_type,
        attribute.attnotnull as not_null,
        pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) as default_expression
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class class on class.oid = attribute.attrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      left join pg_catalog.pg_attrdef default_value
        on default_value.adrelid = attribute.attrelid
       and default_value.adnum = attribute.attnum
      where namespace.nspname = 'parameter_catalog'
        and attribute.attnum > 0
        and not attribute.attisdropped
      order by class.relname, attribute.attnum
    `),
      db.query<{
        relation_name: string;
        constraint_name: string;
        definition: string;
      }>(`
      select
        class.relname as relation_name,
        constraint_record.conname as constraint_name,
        pg_catalog.pg_get_constraintdef(constraint_record.oid, true) as definition
      from pg_catalog.pg_constraint constraint_record
      join pg_catalog.pg_class class on class.oid = constraint_record.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'parameter_catalog'
      order by class.relname, constraint_record.conname
    `),
      db.query<{
        relation_name: string;
        index_name: string;
        definition: string;
      }>(`
      select
        table_record.relname as relation_name,
        index_record.relname as index_name,
        pg_catalog.pg_get_indexdef(index_record.oid) as definition
      from pg_catalog.pg_index index_metadata
      join pg_catalog.pg_class table_record on table_record.oid = index_metadata.indrelid
      join pg_catalog.pg_class index_record on index_record.oid = index_metadata.indexrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = table_record.relnamespace
      where namespace.nspname = 'parameter_catalog'
      order by table_record.relname, index_record.relname
    `),
      db.query<{
        relation_name: string;
        trigger_name: string;
        definition: string;
      }>(`
      select
        class.relname as relation_name,
        trigger_record.tgname as trigger_name,
        pg_catalog.pg_get_triggerdef(trigger_record.oid, true) as definition
      from pg_catalog.pg_trigger trigger_record
      join pg_catalog.pg_class class on class.oid = trigger_record.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'parameter_catalog'
        and not trigger_record.tgisinternal
      order by class.relname, trigger_record.tgname
    `),
      db.query<{
        function_name: string;
        identity_arguments: string;
        definition: string;
      }>(`
      select
        procedure.proname as function_name,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
        pg_catalog.pg_get_functiondef(procedure.oid) as definition
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'parameter_catalog'
      order by procedure.proname, pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    `),
    ]);

  return createHash("sha256")
    .update(
      JSON.stringify({
        relations: relations.rows,
        columns: columns.rows,
        constraints: constraints.rows,
        indexes: indexes.rows,
        triggers: triggers.rows,
        functions: functions.rows,
      }),
    )
    .digest("hex");
}

describe("canonical Catalog privilege boundary and migration paths", () => {
  it("exposes only an execute-revoked scalar current-release guard to PUBLIC", async () => {
    await withTempDatabase({ prefix: "pcat_privileges" }, async ({ db }) => {
      const result = await db.query<{
        return_type: string;
        security_definer: boolean;
        config: string[];
        public_execute: boolean;
        public_table_privileges: string;
      }>(`
        select
          pg_catalog.format_type(proc.prorettype, null) as return_type,
          proc.prosecdef as security_definer,
          proc.proconfig as config,
          pg_catalog.has_function_privilege(
            'public',
            'parameter_catalog.assert_catalog_subject_active(text,text,text,text)',
            'execute'
          ) as public_execute,
          (
            select count(*)::text
            from information_schema.role_table_grants grant_record
            where grant_record.table_schema = 'parameter_catalog'
              and grant_record.grantee = 'PUBLIC'
          ) as public_table_privileges
        from pg_catalog.pg_proc proc
        join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
        where namespace.nspname = 'parameter_catalog'
          and proc.proname = 'assert_catalog_subject_active'
      `);

      const publicExecute = await db.query<{ proname: string }>(`
        select proc.proname
        from pg_catalog.pg_proc proc
        join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
        where namespace.nspname = 'parameter_catalog'
          and proc.prosecdef
          and pg_catalog.has_function_privilege('public', proc.oid, 'execute')
        order by proc.proname
      `);
      expect(publicExecute.rows).toEqual([]);

      const pointerLock = await db.query<{ public_execute: boolean }>(`
        select pg_catalog.has_function_privilege(
          'public',
          'parameter_catalog.lock_catalog_state_pointer()',
          'execute'
        ) as public_execute
      `);
      expect(pointerLock.rows).toEqual([{ public_execute: false }]);

      expect(result.rows).toEqual([
        {
          return_type: "void",
          security_definer: true,
          config: ["search_path=pg_catalog, parameter_catalog"],
          public_execute: false,
          public_table_privileges: "0",
        },
      ]);
    });
  });

  it("applies as the one contiguous suffix after the supported 0136 floor", async () => {
    await withTempDatabase(
      { prefix: "pcat_floor", migrate: false },
      async ({ db }) => {
        const floorApplied = await applyMigrations(db, migrationsDir, {
          through: floorMigration,
        });
        expect(floorApplied.at(-1)).toBe(floorMigration);
        expect(
          await db.query(
            "select 1 from pg_catalog.pg_namespace where nspname = 'parameter_catalog'",
          ),
        ).toMatchObject({ rowCount: 0 });

        const candidateApplied = await applyMigrations(db, migrationsDir, {
          through: catalogMigration,
        });
        expect(candidateApplied).toEqual([catalogMigration]);
        expect(
          await applyMigrations(db, migrationsDir, {
            through: catalogMigration,
          }),
        ).toEqual([]);

        const ledger = await db.query<{ name: string; checksum: string }>(
          "select name, checksum from public.schema_migrations order by name desc limit 1",
        );
        expect(ledger.rows).toEqual([
          {
            name: catalogMigration,
            checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
        ]);
      },
    );
  });

  it("keeps the legacy public parameter tables byte-shape compatible during expansion", async () => {
    await withTempDatabase(
      { prefix: "pcat_compat", migrate: false },
      async ({ db }) => {
        await applyMigrations(db, migrationsDir, { through: floorMigration });

        const legacyColumnContract = async () =>
          db.query<{
            table_name: string;
            ordinal_position: number;
            column_name: string;
            data_type: string;
            is_nullable: string;
            column_default: string | null;
          }>(`
        select
          table_name,
          ordinal_position,
          column_name,
          data_type,
          is_nullable,
          column_default
        from information_schema.columns
        where table_schema = 'public'
          and table_name in (
            'parameter_definitions',
            'project_parameter_bindings',
            'project_parameter_values'
          )
        order by table_name, ordinal_position
      `);

        const before = await legacyColumnContract();
        await applyMigrations(db, migrationsDir, { through: catalogMigration });
        const after = await legacyColumnContract();
        const canonicalDefinitionColumns = await db.query<{
          column_name: string;
        }>(`
        select column_name
        from information_schema.columns
        where table_schema = 'parameter_catalog'
          and table_name = 'parameter_definitions'
        order by ordinal_position
      `);

        expect(before.rows.length).toBeGreaterThan(0);
        expect(after.rows).toEqual(before.rows);
        expect(
          canonicalDefinitionColumns.rows.map((row) => row.column_name),
        ).toEqual([
          "id",
          "introduced_release_id",
          "subject_id",
          "property_key",
          "current_revision_id",
        ]);
      },
    );
  });

  it("produces the same deterministic schema fingerprint from fresh and supported-floor paths", async () => {
    let freshFingerprint = "";
    let upgradeFingerprint = "";

    await withTempDatabase({ prefix: "pcat_fresh" }, async ({ db }) => {
      freshFingerprint = await canonicalSchemaFingerprint(db);
    });

    await withTempDatabase(
      { prefix: "pcat_upgrade", migrate: false },
      async ({ db }) => {
        await applyMigrations(db, migrationsDir, { through: floorMigration });
        await applyMigrations(db, migrationsDir, { through: catalogMigration });
        upgradeFingerprint = await canonicalSchemaFingerprint(db);
      },
    );

    expect(freshFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(upgradeFingerprint).toBe(freshFingerprint);
    expect(freshFingerprint).toBe(
      "641c18ade63f48163ca79649628c03e91ec483dce1ad15a3256468dff5062626",
    );
  });
});
