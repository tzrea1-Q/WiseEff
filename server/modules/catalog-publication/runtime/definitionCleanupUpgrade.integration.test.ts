import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { createHttpServer } from "../../../shared/http/server";
import { createRouter } from "../../../shared/http/router";
import { requestJson } from "../../../test/testClient";
import { makeTestAuthContext } from "../../../testing/authContext";
import { migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { withTestClusterRoleCatalogLock } from "../../../testing/testDatabase";
import { registerDefinitionDeletionRoutes } from "../../parameter-catalog-api/definitionDeletion/routes";
import { listDefinitionErasures } from "../../parameter-catalog-api/definitionDeletion/service";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "./provisionRuntimeLogins";

const routines = [
  "preview_parameter_definition_purge(text)",
  "lock_parameter_definition_purge(text)",
  "purge_parameter_definition(text,jsonb,text,text)",
  "read_parameter_definition_erasure(text)",
  "list_definition_erasures(text)",
  "finish_parameter_definition_erasure_object(text,text)",
  "lock_parameter_plane_archive()",
  "definition_erasure_object_is_referenced(text,text)",
].map(name => `parameter_catalog.${name}`);

describe("definition cleanup privileges on a populated API LOGIN upgrade", () => {
  it("repairs an older NOINHERIT writer without prior erasure grants or a provisioning rerun", async () => {
    await withTempDatabase({ prefix: "cleanup_acl_upgrade", migrate: false }, async ({ db, connectionString }) => {
      await applyMigrations(db, migrationsDir, { before: "0145" });
      const token = `cu${randomBytes(5).toString("hex")}`;
      const login = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
      const api = createPostgresDatabase(login.apiUrl);
      const otherLogins = [login.workerUrl, login.managerUrl].map(url => createPostgresDatabase(url));
      const outsider = `cleanup_unrelated_${token}`;
      const noSet = `cleanup_no_set_${token}`;
      try {
        await withTestClusterRoleCatalogLock(async () => {
          await db.query(`create role ${pg.escapeIdentifier(outsider)} login nosuperuser noinherit`);
          await db.query(`create role ${pg.escapeIdentifier(noSet)} login nosuperuser noinherit`);
          try {
            await db.query(`grant parameter_governance_writer_role to ${pg.escapeIdentifier(noSet)} with inherit false, set false`);
            expect((await db.query(`select pg_has_role($1,'parameter_governance_writer_role','MEMBER') as member,
              pg_has_role($1,'parameter_governance_writer_role','SET') as can_set`, [noSet])).rows)
              .toEqual([{ member: true, can_set: false }]);
            await applyMigrations(db, migrationsDir, { before: "0257" });
            const auth = makeTestAuthContext({ roleId: "platform-admin", organizationId: "org-cleanup-upgrade" });
            await expect(listDefinitionErasures(api, auth)).rejects.toMatchObject({ code: "42501" });
            expect((await api.query(`select
              has_function_privilege(current_user,'parameter_catalog.read_parameter_definition_erasure(text)','EXECUTE') as old_reader,
              has_function_privilege(current_user,'parameter_catalog.list_definition_erasures(text)','EXECUTE') as cleanup`
            )).rows).toEqual([{ old_reader: false, cleanup: false }]);
            await db.query(`insert into parameter_catalog.definition_erasures
              (definition_id,erased_by,audit_event_id,organization_id,pending_object_refs)
              values ('cleanup-a','old-operator','audit-a','org-cleanup-upgrade',array['plane::object-a']),
                     ('cleanup-b','old-operator','audit-b','org-other',array['plane::object-b'])`);

            // Only the official migration runner changes the existing LOGIN's grants.
            await applyMigrations(db, migrationsDir);
            expect((await api.query(`select current_user as actor,session_user as login,rolsuper,rolinherit
              from pg_roles where rolname=current_user`)).rows).toEqual([
              { actor: login.apiRole, login: login.apiRole, rolsuper: false, rolinherit: false },
            ]);
            const acl = await api.query<{ allowed: boolean }>(
              "select has_function_privilege(current_user,routine,'EXECUTE') as allowed from unnest($1::text[]) routine", [routines],
            );
            expect(acl.rows).toEqual(routines.map(() => ({ allowed: true })));
            const router = createRouter();
            registerDefinitionDeletionRoutes(router, { db: api, resolveAuth: () => auth });
            const response = await requestJson<{ items: { definitionId: string; pendingObjectCount: number }[] }>(
              createHttpServer(router), "/api/v2/catalog/definition-erasures",
            );
            expect(response.status).toBe(200);
            expect(response.body.items).toEqual([
              expect.objectContaining({ definitionId: "cleanup-a", pendingObjectCount: 1 }),
            ]);
            await expect(listDefinitionErasures(api, makeTestAuthContext({ roleId: "admin" })))
              .rejects.toMatchObject({ code: "FORBIDDEN" });
            for (const other of otherLogins) {
              await expect(other.query("select * from parameter_catalog.list_definition_erasures($1)", [auth.organization.id]))
                .rejects.toMatchObject({ code: "42501" });
            }
            for (const denied of [outsider, noSet]) {
              expect((await db.query("select has_function_privilege($1,routine,'EXECUTE') as allowed from unnest($2::text[]) routine",
                [denied, routines])).rows).toEqual(routines.map(() => ({ allowed: false })));
            }
            for (const relation of ["parameter_catalog.definition_erasures", "parameter_catalog.parameter_definitions"]) {
              await expect(api.query(`delete from ${relation} where false`)).rejects.toMatchObject({ code: "42501" });
            }
            expect(await applyMigrations(db, migrationsDir)).toEqual([]);
          } finally {
            await db.query(`drop role ${pg.escapeIdentifier(outsider)}`);
            await db.query(`drop role ${pg.escapeIdentifier(noSet)}`);
          }
        });
      } finally {
        await Promise.all([api, ...otherLogins].map(database => database.close()));
        expect((await dropLabRuntimeLogins(connectionString, token)).failed).toEqual([]);
      }
    });
  }, 120_000);
});
