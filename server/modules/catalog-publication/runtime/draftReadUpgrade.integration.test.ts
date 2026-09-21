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
        await expect(api.query("insert into parameter_catalog.project_value_source_pins select * from parameter_catalog.project_value_source_pins where false"))
          .rejects.toMatchObject({ code: "42501" });
      } finally {
        await api.close();
        const cleanup = await dropLabRuntimeLogins(connectionString, token);
        expect(cleanup.failed).toEqual([]);
      }
    });
  }, 60_000);
});
