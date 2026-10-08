import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { createHttpServer } from "../../../shared/http/server";
import { createRouter } from "../../../shared/http/router";
import { requestJson } from "../../../test/testClient";
import { makeTestAuthContext } from "../../../testing/authContext";
import { migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { registerCatalogProjectValueConsumerRoutes } from "../../parameter-bindings/catalogProjectValueRoutes";
import { listCanonicalValueDrafts } from "../../parameter-bindings/drafts/repository";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "./provisionRuntimeLogins";

describe("existing API LOGIN privilege refresh after a parameter schema upgrade", () => {
  it.each(["0145", "0150"])("restores draft reads without rotating logins provisioned before %s", async (before) => {
    await withTempDatabase({ prefix: "draft_acl_upgrade", migrate: false }, async ({ db, connectionString }) => {
      await applyMigrations(db, migrationsDir, { before });
      const token = `du${randomBytes(5).toString("hex")}`;
      const login = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
      const api = createPostgresDatabase(login.apiUrl);
      try {
        expect((await api.query(`select
          to_regclass('parameter_catalog.project_parameter_source_occurrences') as occurrences,
          to_regclass('parameter_catalog.project_value_source_pins') as pins,
          to_regprocedure('parameter_catalog.resolve_current_binding_by_source_occurrence(text,text,text)') as resolver`
        )).rows[0]).toEqual({ occurrences: null, pins: null, resolver: null });
        await db.query("insert into organizations (id,name) values ('org-draft-upgrade','Draft upgrade')");
        await db.query(`insert into users (id,organization_id,name,email,title)
          values ('user-draft-upgrade','org-draft-upgrade','Editor','draft-upgrade@example.com','Editor')`);
        await db.query(`insert into projects (id,organization_id,name,code,status)
          values ('project-draft-upgrade','org-draft-upgrade','Draft upgrade','DUP','initialized')`);
        await applyMigrations(db, migrationsDir);
        const refreshed = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
        expect(refreshed.created).toEqual([]);
        expect(refreshed.passwordsDelivered).toBe(false);
        expect(refreshed.rotatePasswords).toBe(false);
        expect(refreshed.reused).toEqual([login.apiRole, login.workerRole, login.managerRole]);
        const auth = makeTestAuthContext({
          organizationId: "org-draft-upgrade", userId: "user-draft-upgrade",
          roles: [{ roleId: "software-user", projectId: "project-draft-upgrade" }],
          permissions: ["parameter:view", "parameter:edit"]
        });
        // Real non-superuser LOGIN: an empty result still needs every joined table's SELECT.
        await expect(listCanonicalValueDrafts(api, {
          organizationId: auth.organization.id, userId: auth.user.id, projectId: "project-draft-upgrade"
        })).resolves.toEqual([]);
        const router = createRouter();
        registerCatalogProjectValueConsumerRoutes(router, { db: api, getCurrentAuthContext: () => auth });
        const response = await requestJson(createHttpServer(router),
          "/api/v2/projects/project-draft-upgrade/parameter-value-drafts");
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ items: [] });
        await expect(api.query("delete from catalog_publication.publication_jobs where false"))
          .rejects.toMatchObject({ code: "42501" });
        await expect(api.query("delete from parameter_catalog.catalog_releases where false"))
          .rejects.toMatchObject({ code: "42501" });
        for (const relation of [
          "parameter_catalog.project_parameter_source_occurrences",
          "parameter_catalog.project_value_source_pins",
          "parameter_catalog.current_project_parameter_bindings",
        ]) {
          expect((await api.query(`select
            has_table_privilege(current_user,$1,'INSERT') as insert,
            has_table_privilege(current_user,$1,'UPDATE') as update,
            has_column_privilege(current_user,$1,'id','UPDATE') as lock`, [relation]
          )).rows[0]).toEqual({ insert: !relation.endsWith("current_project_parameter_bindings"), update: false, lock: true });
          await expect(api.query(`select id from ${relation} where false for update nowait`)).resolves.toMatchObject({ rowCount: 0 });
          await expect(api.query(`select id from ${relation} where false for share nowait`)).resolves.toMatchObject({ rowCount: 0 });
          await expect(api.query(`update ${relation} set project_id=project_id where false`)).rejects.toMatchObject({ code: "42501" });
          await expect(api.query(`delete from ${relation} where false`)).rejects.toMatchObject({ code: "42501" });
        }
        for (const relation of ["project_parameter_source_occurrences", "project_value_source_pins"]) {
          await expect(api.query(`insert into parameter_catalog.${relation} select * from parameter_catalog.${relation} where false`))
            .resolves.toMatchObject({ rowCount: 0 });
        }
        await expect(api.query("select parameter_catalog.is_replaced_current_binding('missing-binding') as replaced"))
          .resolves.toMatchObject({ rows: [{ replaced: false }] });
        await expect(api.query("select parameter_catalog.resolve_current_binding_by_source_occurrence('project-draft-upgrade','missing-occurrence','missing-definition') as binding"))
          .resolves.toMatchObject({ rows: [{ binding: null }] });
      } finally {
        await api.close();
        const cleanup = await dropLabRuntimeLogins(connectionString, token);
        expect(cleanup.failed).toEqual([]);
      }
    });
  }, 60_000);
});
