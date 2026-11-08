import { describe, expect, it } from "vitest";
import { applyMigrations, migrationsDir, withTempDatabase } from "../tempDatabase";
import {
  readCanonicalSchemaFingerprint,
  S2_SCH_0334_FINGERPRINT,
  S2_SCH_0335_FINGERPRINT,
} from "./database";

describe("module driver publication Catalog fingerprint migration", () => {
  it("adds only the publication table and the exact organization-deletion function changes", async () => {
    await withTempDatabase({ prefix: "driver_catalog", migrate: false }, async ({ db, connectionString }) => {
      await applyMigrations(db, migrationsDir, { through: "0334_user_import_receipts.sql" });
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(S2_SCH_0334_FINGERPRINT);
      const definition = async (signature: string) => (
        await db.query<{ sql: string }>("select pg_get_functiondef($1::regprocedure) as sql", [signature])
      ).rows[0].sql;
      const signatures = {
        preview: "parameter_catalog.preview_organization_deletion_0276(text,text)",
        purge: "parameter_catalog.purge_organization_parameter_assets(text,text,text)",
        guard: "public.guard_organization_lifecycle()",
      };
      const before = {
        preview: await definition(signatures.preview),
        purge: await definition(signatures.purge),
        guard: await definition(signatures.guard),
      };

      await applyMigrations(db, migrationsDir, { through: "0335_module_structure_driver_publications.sql" });
      const previewEntry = "('parameter_catalog.module_structure_migration_map','organization-parameters','r.organization_id=$1')";
      const purgeEntry = "('parameter_catalog.module_structure_migration_map','organization_id=$1')";
      const purgeLock = "  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.";
      const guardEntry = "'module_structure_migration_map',";
      expect(before.preview).toContain(previewEntry);
      expect(before.purge).toContain(purgeEntry);
      expect(before.purge).toContain(purgeLock);
      expect(before.guard).toContain(guardEntry);
      expect(await definition(signatures.preview)).toBe(before.preview.replace(
        previewEntry,
        "('parameter_catalog.module_structure_driver_publications','organization-parameters','r.organization_id=$1')," + previewEntry,
      ));
      expect(await definition(signatures.purge)).toBe(before.purge.replace(
        purgeLock,
        "  lock table parameter_catalog.module_structure_driver_publications in share row exclusive mode;\n" + purgeLock,
      ).replace(
        purgeEntry,
        "('parameter_catalog.module_structure_driver_publications','organization_id=$1')," + purgeEntry,
      ));
      expect(await definition(signatures.guard)).toBe(before.guard.replace(
        guardEntry,
        "'module_structure_migration_map','module_structure_driver_publications',",
      ));

      const columns = await db.query<{ name: string; type: string; required: boolean; default_expression: string | null }>(`
        select a.attname as name, format_type(a.atttypid,a.atttypmod) as type,
          a.attnotnull as required, pg_get_expr(d.adbin,d.adrelid) as default_expression
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid='parameter_catalog.module_structure_driver_publications'::regclass
          and a.attnum>0 and not a.attisdropped order by a.attnum
      `);
      expect(columns.rows).toEqual([
        { name: "organization_id", type: "text", required: true, default_expression: null },
        { name: "export_id", type: "text", required: true, default_expression: null },
        { name: "declarations_digest", type: "text", required: true, default_expression: null },
        { name: "declarations", type: "jsonb", required: true, default_expression: null },
        { name: "candidate_id", type: "text", required: true, default_expression: null },
        { name: "job_id", type: "text", required: true, default_expression: null },
        { name: "allocated_subjects", type: "jsonb", required: true, default_expression: null },
        { name: "applied_receipt", type: "jsonb", required: false, default_expression: null },
        { name: "created_at", type: "timestamp with time zone", required: true, default_expression: "clock_timestamp()" },
      ]);
      expect((await db.query<{ kind: string; count: number }>(`
        select contype::text as kind,count(*)::int as count from pg_constraint
        where conrelid='parameter_catalog.module_structure_driver_publications'::regclass
        group by contype order by contype
      `)).rows).toEqual([{ kind: "c", count: 3 }, { kind: "f", count: 3 }, { kind: "p", count: 1 }]);
      expect((await db.query<{ trigger_name: string }>(`
        select tgname as trigger_name from pg_trigger
        where tgrelid='parameter_catalog.module_structure_driver_publications'::regclass and not tgisinternal
      `)).rows).toEqual([{ trigger_name: "organization_lifecycle_guard" }]);
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(S2_SCH_0335_FINGERPRINT);

      // Reverse only the declared additions inside this disposable database. The
      // entire previous fingerprint must return, detecting unrelated changes to
      // any existing Catalog relation, column, constraint, index, trigger or function.
      await db.query(before.preview);
      await db.query(before.purge);
      await db.query(before.guard);
      await db.query("drop table parameter_catalog.module_structure_driver_publications");
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(S2_SCH_0334_FINGERPRINT);
    });
  }, 120_000);
});
