import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresDatabase, type Database } from "../server/shared/database/client";
import { MIGRATION_ADVISORY_LOCK_KEY } from "../server/shared/database/migrations";
import { readCurrentCatalogPointer, type CatalogPointerClient } from "../server/modules/catalog-kernel/install/currentPointer";
import { loadProjection } from "../server/modules/catalog-kernel/runtime/currentSnapshot";

const sourceSha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
// Observed from the unchanged source image, including its real checkpointer
// initialization: 1363 public columns and 661 constraints. This is a bounded
// supported source shape, not permission to repair an unknown deployment.
const sourceShape = "52efebdcb68474b6e587419a0331d0218ec9cc1691016b5989c162007baceabf";
const retiredSourceShape = "d838efd6a35193a03f72faf0645455a60a40dc6ff67325bf56a41a3ed52a7d05";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export const parameterSourceShapeSql = `select json_build_object(
  'columns',(select json_agg(t order by t.table_name,t.ordinal_position) from (
    select table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
    from information_schema.columns where table_schema='public') t),
  'constraints',(select json_agg(t order by t.table_name,t.name) from (
    select c.relname as table_name, con.conname as name,pg_get_constraintdef(con.oid) as definition
    from pg_constraint con join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public') t)
) as shape`;

/** Inspect/initialize observe only; prepare can create the empty retired legacy
 * compatibility relations. Never seed, change permissions, delete legacy rows,
 * backfill the ledger or fabricate a release. */
export async function runParameterDataMode(db: Database, input: {
  phase: "inspect" | "prepare" | "initialize";
  sourceSha: string;
  migrationsDir?: string;
}) {
  const directory = input.migrationsDir ?? path.join(root, "server/migrations");
  const files = (await readdir(directory)).filter(file => file.endsWith(".sql")).sort();
  const inventory = await Promise.all(files.map(async name => ({ name, checksum: digest(await readFile(path.join(directory, name), "utf8")) })));
  return db.transaction(async tx => {
    if (input.phase === "prepare") {
      await tx.query("select pg_advisory_xact_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
    } else {
      await tx.query("set transaction isolation level repeatable read, read only");
    }
    const applied = await tx.query<{ name: string; checksum: string | null }>("select name, checksum from schema_migrations order by name");
    if (applied.rows.length === 0 || applied.rows.length > inventory.length || applied.rows.some((row, i) =>
      row.name !== inventory[i].name || row.checksum !== inventory[i].checksum)) {
      throw new Error("parameter-data-mode-ledger-unknown-or-drifted");
    }
    const legacyCount = files.filter(name => name < "0129_").length;
    const canonicalCount = files.filter(name => name < "0140_").length;
    if (applied.rows.length === legacyCount && input.phase !== "initialize") {
      if (input.sourceSha !== sourceSha) throw new Error("parameter-data-mode-source-sha-unsupported");
      const schema = await tx.query<{ present: boolean }>("select exists(select 1 from pg_namespace where nspname='parameter_catalog') as present");
      type ShapeRow = { table_name: string; [key: string]: unknown };
      const observed = await tx.query<{ shape: { columns: ShapeRow[]; constraints: ShapeRow[] } }>(parameterSourceShapeSql);
      const shape = observed.rows[0].shape;
      // pg_dump/restore compacts dropped-column attnums. Keep logical column
      // order and every definition, but exclude these physical slot numbers.
      shape.columns = shape.columns.map(({ ordinal_position: _slot, ...column }) => column);
      const full = digest(JSON.stringify(shape));
      const withoutCompatibility = Object.fromEntries(Object.entries(shape).map(([key, rows]) =>
        [key, rows.filter(row => !["project_parameter_values", "parameter_definitions"].includes(row.table_name))]));
      const retired = digest(JSON.stringify(withoutCompatibility)) === retiredSourceShape;
      if (schema.rows[0].present || (full !== sourceShape && !retired)) {
        throw new Error("parameter-data-mode-source-schema-unsupported");
      }
      if (retired) {
        const cutover = await tx.query<{ valid: boolean }>(`select
          (select count(*) from parameter_identity_cutovers)=1 and exists(
            select 1 from parameter_identity_cutovers c join parameter_identity_migration_runs r
              on r.id=c.migration_run_id where r.status='finalized') as valid`);
        if (!cutover.rows[0].valid) throw new Error("parameter-data-mode-retired-source-unverified");
        for (const table of ["parameter_definitions", "project_parameter_values"] as const) {
          const present = shape.columns.some(row => row.table_name === table);
          if (present) {
            const columns = (table: string) => shape.columns.filter(row => row.table_name === table)
              .map(({ table_name: _table, ...column }) => column);
            const constraints = (table: string) => shape.constraints.filter(row => row.table_name === table)
              .map(row => String(row.definition)).sort();
            const rows = await tx.query<{ populated: boolean }>(`select exists(select 1 from public.${table}) as populated`);
            if (JSON.stringify(columns(table)) !== JSON.stringify(columns(`legacy_${table}`)) ||
              JSON.stringify(constraints(table)) !== JSON.stringify(constraints(`legacy_${table}`)) || rows.rows[0].populated) {
              throw new Error("parameter-data-mode-compatibility-table-drift");
            }
          } else if (input.phase === "prepare") {
            // The old, formally retired table remains untouched. Recreate only
            // the empty structural relations referenced by immutable 0129–0138.
            // The verified cutover marker keeps runtime identity mode semantic.
            await tx.query(`create table public.${table} (like public.legacy_${table} including all)`);
            await tx.query(`do $$ declare constraint_row record; begin
              for constraint_row in select conname, pg_get_constraintdef(oid) as definition
                from pg_constraint where conrelid='public.legacy_${table}'::regclass and contype='f'
              loop execute format('alter table public.${table} add constraint %I %s', constraint_row.conname, constraint_row.definition); end loop;
            end $$`);
          }
        }
      }
      return { parameterDataMode: "new-empty", state: "legacy-populated", migrationsApplied: applied.rows.length } as const;
    }
    if (applied.rows.length < canonicalCount || (input.phase === "initialize" && applied.rows.length !== files.length)) {
      throw new Error("parameter-data-mode-partial-migration");
    }
    const state = await tx.query<{ states: string; releases: string; subjects: string; definitions: string }>(`select
      (select count(*) from parameter_catalog.catalog_state)::text as states,
      (select count(*) from parameter_catalog.catalog_releases)::text as releases,
      (select count(*) from parameter_catalog.catalog_subjects)::text as subjects,
      (select count(*) from parameter_catalog.parameter_definitions)::text as definitions`);
    const current = state.rows[0];
    if (Object.values(current).every(value => value === "0")) {
      return { parameterDataMode: "new-empty", state: "canonical-unpublished", migrationsApplied: applied.rows.length } as const;
    }
    // Existing published data is never reset by a repeated initialization.
    if (current.states !== "1" || current.releases === "0" || current.subjects === "0") {
      throw new Error("parameter-data-mode-partial-catalog");
    }
    // Reuse the owner's projection validation on this same read transaction;
    // never borrow a second pool connection while holding the first one.
    const client = { query: tx.query.bind(tx) as CatalogPointerClient["query"] };
    const pointer = await readCurrentCatalogPointer(client);
    if (pointer.kind !== "installed") throw new Error("parameter-data-mode-partial-catalog");
    const projection = await loadProjection(client, pointer.current.id, "current", pointer.current);
    if (!projection || projection.identity.digest !== pointer.current.digest) {
      throw new Error("parameter-data-mode-catalog-drift");
    }
    // Canonical-installed new-empty observes the existing pointer. It does not
    // reset catalogs and does not claim P13 writer retirement.
    return { parameterDataMode: "new-empty", state: "canonical-installed", migrationsApplied: applied.rows.length } as const;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [phase, source, ...extra] = process.argv.slice(2);
  if (!process.env.DATABASE_URL || !["inspect", "prepare", "initialize"].includes(phase) || !/^[a-f0-9]{40}$/.test(source ?? "") || extra.length) {
    console.error("Usage: parameter-data-mode.ts inspect|prepare|initialize SOURCE_SHA (DATABASE_URL required)");
    process.exitCode = 2;
  } else {
    const db = createPostgresDatabase(process.env.DATABASE_URL);
    try {
      console.log(JSON.stringify(await runParameterDataMode(db, { phase: phase as "inspect" | "prepare" | "initialize", sourceSha: source })));
    } catch (error) {
      const message = error instanceof Error && error.message.startsWith("parameter-data-mode-") ? error.message : "parameter-data-mode-observation-failed";
      console.error(message);
      process.exitCode = 1;
    } finally { await db.close(); }
  }
}
