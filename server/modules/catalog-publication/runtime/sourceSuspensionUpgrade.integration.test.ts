import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { createPostgresDatabase } from "../../../shared/database/client";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { withTestClusterRoleCatalogLock } from "../../../testing/testDatabase";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins, publicationRuntimeOwnershipComment } from "../../../testing/labRuntimeLogins";

const receiptTable = "parameter_catalog.source_binding_suspension_receipts";
const lookup = "parameter_catalog.find_source_binding_suspension(text,text,text,text,jsonb)";

it("upgrades existing source API logins to the bounded suspension lookup without exposing receipts", async () => {
  await withTempDatabase({ prefix: "scope_acl_upgrade", migrate: false }, async ({ db, connectionString }) => {
    await applyMigrations(db, migrationsDir, { through: "0325_retired_source_revision_continuity.sql" });
    await db.query("insert into organizations(id,name) values('scope-upgrade-org','Existing source organization')");
    await db.query(`insert into projects(id,organization_id,name,code)
      values('scope-upgrade-project','scope-upgrade-org','Existing source project','SCOPEUP')`);
    const token = `su${randomBytes(5).toString("hex")}`;
    const runtime = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
    const api = createPostgresDatabase(runtime.apiUrl);
    const denied = [runtime.workerUrl, runtime.managerUrl].map(url => createPostgresDatabase(url));
    const noLocalAuthority = `scope_foreign_${token}`;
    const unownedAuthority = `scope_unowned_${token}`;
    try {
      expect((await api.query(`select current_user as actor,rolsuper,rolinherit,
        has_table_privilege(current_user,'parameter_catalog.project_value_source_pins','INSERT') as source_writer
        from pg_roles where rolname=current_user`)).rows).toEqual([
        { actor: runtime.apiRole, rolsuper: false, rolinherit: false, source_writer: true }
      ]);
      expect((await db.query("select to_regclass($1) as receipt,to_regprocedure($2) as lookup", [receiptTable, lookup])).rows)
        .toEqual([{ receipt: null, lookup: null }]);

      await withTestClusterRoleCatalogLock(async () => {
        for (const role of [noLocalAuthority, unownedAuthority]) {
          await db.query(`create role ${pg.escapeIdentifier(role)} login nosuperuser noinherit nocreaterole nocreatedb noreplication`);
          await db.query(`grant parameter_governance_writer_role to ${pg.escapeIdentifier(role)}`);
        }
        try {
          // A genuine runtime comment and SET ROLE membership alone must not
          // acquire an RPC in a database where the role has no source authority.
          await db.query(`comment on role ${pg.escapeIdentifier(noLocalAuthority)} is ${pg.escapeLiteral(publicationRuntimeOwnershipComment("lab", token))}`);
          // The reverse is also insufficient: an unrelated source-capable role
          // is not a provisioned runtime merely because its grants resemble one.
          await db.query(`grant insert on parameter_catalog.project_value_source_pins to ${pg.escapeIdentifier(unownedAuthority)}`);
          // Simulate broad pre-existing table defaults for every runtime kind.
          // The migration must remove these direct grants on its new private table.
          for (const role of [runtime.workerRole, runtime.managerRole]) {
            await db.query(`alter default privileges in schema parameter_catalog grant select on tables to ${pg.escapeIdentifier(role)}`);
          }

          // Reuse the original connections and credentials; do not reprovision.
          await applyMigrations(db, migrationsDir, { through: "0326_source_managed_scope_receipts.sql" });
          expect((await api.query("select name from projects where id='scope-upgrade-project'")).rows)
            .toEqual([{ name: "Existing source project" }]);
          await expect(api.query(`select parameter_catalog.find_source_binding_suspension($1,$2,$3,$4,$5::jsonb) as prior`,
            ["scope-upgrade-org", "scope-upgrade-project", "missing-set", "missing-revision", "{}"])).resolves.toMatchObject({ rows: [{ prior: null }] });

          for (const role of [runtime.apiRole, runtime.workerRole, runtime.managerRole]) {
            expect((await db.query(`select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as table_access,
              has_function_privilege($1,'parameter_catalog.mint_source_binding_suspensions()','EXECUTE') as mint,
              has_function_privilege($1,$3,'EXECUTE') as lookup`, [role, receiptTable, lookup])).rows)
              .toEqual([{ table_access: false, mint: false, lookup: role === runtime.apiRole }]);
          }
          for (const connection of [api, ...denied]) {
            for (const statement of [
              `select * from ${receiptTable} limit 0`,
              `insert into ${receiptTable} default values`,
              `update ${receiptTable} set request_id=request_id where false`,
              `delete from ${receiptTable} where false`,
            ]) await expect(connection.query(statement)).rejects.toMatchObject({ code: "42501" });
          }
          for (const connection of denied) {
            await expect(connection.query("select parameter_catalog.find_source_binding_suspension('org','project','set','revision','{}')"))
              .rejects.toMatchObject({ code: "42501" });
          }
          for (const role of [noLocalAuthority, unownedAuthority]) {
            expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') as lookup", [role, lookup])).rows)
              .toEqual([{ lookup: false }]);
          }
        } finally {
          for (const role of [noLocalAuthority, unownedAuthority]) {
            await db.query(`drop owned by ${pg.escapeIdentifier(role)}`);
            await db.query(`drop role ${pg.escapeIdentifier(role)}`);
          }
        }
      });
    } finally {
      await api.close();
      for (const connection of denied) await connection.close();
      expect((await dropLabRuntimeLogins(connectionString, token)).failed).toEqual([]);
    }
  });
}, 120_000);
