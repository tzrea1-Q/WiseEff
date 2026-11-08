import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { createPostgresDatabase } from "../../../shared/database/client";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../../testing/labRuntimeLogins";

const publicationTable = "parameter_catalog.module_structure_driver_publications";
const migration = "0335_module_structure_driver_publications.sql";
const mutableColumns = ["candidate_id", "job_id", "allocated_subjects", "applied_receipt"];
const immutableColumns = ["organization_id", "export_id", "declarations_digest", "declarations", "created_at"];

it("upgrades an existing API login with bounded publication progress grants and preserves populated module exports", async () => {
  await withTempDatabase({ prefix: "module_driver_upgrade", migrate: false }, async ({ db, connectionString }) => {
    await applyMigrations(db, migrationsDir, { through: "0334_user_import_receipts.sql" });
    await db.query("insert into organizations(id,name) values ('driver-upgrade-org','Retained driver organization')");
    await db.query(`insert into parameter_modules(id,organization_id,name,path,kind,origin,description)
      values ('driver-upgrade-module','driver-upgrade-org','Retained module','driver-upgrade-module','business','curated','Preserve this description')`);
    await db.query(`insert into parameter_catalog.module_structure_export_baselines(export_id,organization_id,document)
      values ('driver-upgrade-export','driver-upgrade-org',$1::jsonb)`, [JSON.stringify({
      format: "wiseeff-module-structure", version: 1,
      source: { exportId: "driver-upgrade-export", organizationId: "driver-upgrade-org", catalogReleaseId: "retained-release" },
      modules: [{ ref: "driver-upgrade-module", sourceId: "driver-upgrade-module", name: "Retained module" }], subjects: [],
    })]);
    const retained = async () => ({
      organization: (await db.query("select * from organizations where id='driver-upgrade-org'")).rows,
      modules: (await db.query("select * from parameter_modules where organization_id='driver-upgrade-org' order by id")).rows,
      baseline: (await db.query("select * from parameter_catalog.module_structure_export_baselines where organization_id='driver-upgrade-org' order by export_id")).rows,
    });
    const before = await retained();
    const token = `dru${randomBytes(5).toString("hex")}`;
    const runtime = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
    const api = createPostgresDatabase(runtime.apiUrl);
    const otherLogins = [runtime.workerUrl, runtime.managerUrl].map(url => createPostgresDatabase(url));
    try {
      expect((await api.query(`select current_user as actor,session_user as login,rolsuper,rolinherit,
        has_table_privilege(current_user,'parameter_catalog.subject_placements','INSERT') as placement_writer
        from pg_roles where rolname=current_user`)).rows).toEqual([
        { actor: runtime.apiRole, login: runtime.apiRole, rolsuper: false, rolinherit: false, placement_writer: true },
      ]);
      expect((await db.query("select to_regclass($1) as publication_table", [publicationTable])).rows)
        .toEqual([{ publication_table: null }]);

      // Apply the official migration on populated state without recreating the
      // previously connected API login or rerunning runtime provisioning.
      expect(await applyMigrations(db, migrationsDir, { through: migration })).toEqual([migration]);
      expect(await applyMigrations(db, migrationsDir, { through: migration })).toEqual([]);
      expect(await retained()).toEqual(before);
      expect((await api.query("select document from parameter_catalog.module_structure_export_baselines where export_id='driver-upgrade-export'")).rows)
        .toEqual([{ document: (before.baseline[0] as { document: unknown }).document }]);
      expect((await api.query(`select has_table_privilege(current_user,$1,'SELECT') as can_read,
        has_table_privilege(current_user,$1,'INSERT') as can_insert,
        has_table_privilege(current_user,$1,'UPDATE') as whole_row_update,
        has_table_privilege(current_user,$1,'DELETE') as can_delete`, [publicationTable])).rows)
        .toEqual([{ can_read: true, can_insert: true, whole_row_update: false, can_delete: false }]);
      expect((await api.query<{ name: string; allowed: boolean }>(`select name,
        has_column_privilege(current_user,$1,name,'UPDATE') as allowed
        from unnest($2::text[]) with ordinality columns(name,position) order by position`,
      [publicationTable, [...mutableColumns, ...immutableColumns]])).rows).toEqual([
        ...mutableColumns.map(name => ({ name, allowed: true })),
        ...immutableColumns.map(name => ({ name, allowed: false })),
      ]);
      await expect(api.query(`select * from ${publicationTable} limit 0`)).resolves.toMatchObject({ rowCount: 0 });
      await expect(api.query(`insert into ${publicationTable}
        (organization_id,export_id,declarations_digest,declarations,candidate_id,job_id,allocated_subjects)
        select 'driver-upgrade-org','driver-upgrade-export','digest','[]'::jsonb,'candidate','job','{}'::jsonb where false`))
        .resolves.toMatchObject({ rowCount: 0 });
      for (const column of mutableColumns) await expect(api.query(`update ${publicationTable}
        set ${pg.escapeIdentifier(column)}=${pg.escapeIdentifier(column)} where false`)).resolves.toMatchObject({ rowCount: 0 });
      for (const column of immutableColumns) await expect(api.query(`update ${publicationTable}
        set ${pg.escapeIdentifier(column)}=${pg.escapeIdentifier(column)} where false`)).rejects.toMatchObject({ code: "42501" });
      await expect(api.query(`delete from ${publicationTable} where false`)).rejects.toMatchObject({ code: "42501" });
      for (const [index, other] of otherLogins.entries()) {
        expect((await db.query(`select has_table_privilege($1,$2,'INSERT,UPDATE,DELETE') as writer`,
          [[runtime.workerRole, runtime.managerRole][index], publicationTable])).rows)
          .toEqual([{ writer: false }]);
        await expect(other.query(`update ${publicationTable} set applied_receipt=applied_receipt where false`))
          .rejects.toMatchObject({ code: "42501" });
      }
      expect(await retained()).toEqual(before);
    } finally {
      await api.close();
      for (const other of otherLogins) await other.close();
      expect((await dropLabRuntimeLogins(connectionString, token)).failed).toEqual([]);
    }
  });
}, 120_000);
