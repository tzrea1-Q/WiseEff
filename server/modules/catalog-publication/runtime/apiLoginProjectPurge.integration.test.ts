import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../../app";
import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";
import { requestJson } from "../../../test/testClient";
import { createManagedInstanceTestDatabase } from "../../../testing/testDatabase";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../../testing/labRuntimeLogins";
import { seedCanonicalParameterFixture } from "../../agent/testing/canonicalParameterFixture";
import { createLocalObjectStore, type ObjectStore } from "../../logs/objectStore";
import { setParameterIdentityMode } from "../../parameter-kernel/parameterIdentityMode";
import type { ProjectDeletionPreview, ProjectDeletionStatus } from "../../../../src/domain/parameters/projectDeletionPreview";

describe("API LOGIN project purge", () => {
  it("previews, deletes, retries object cleanup and reads durable status without private DML privileges", async () => {
    const database = await createManagedInstanceTestDatabase("api-project-purge");
    const owner = createPostgresDatabase(database.url);
    const directory = await mkdtemp(join(tmpdir(), "wiseeff-api-project-purge-"));
    const store = createLocalObjectStore(directory);
    const runToken = `purge${randomBytes(5).toString("hex")}`;
    const logins: RootDatabase[] = [];
    try {
      setParameterIdentityMode("semantic");
      const fixture = await seedCanonicalParameterFixture(owner, store, { sourceFormat: "json" });
      await owner.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values ('api-purge-admin',$1,$2,null,'admin')`, [fixture.reviewerAuth.user.id, fixture.organizationId]);
      const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken });
      const api = createPostgresDatabase(runtime.apiUrl);
      logins.push(api);
      expect((await api.query(`select current_user as actor, session_user as login, rolsuper, rolinherit
        from pg_roles where rolname=current_user`)).rows).toEqual([
        { actor: runtime.apiRole, login: runtime.apiRole, rolsuper: false, rolinherit: false },
      ]);
      const headers = { "X-WiseEff-User": fixture.reviewerAuth.user.id };
      const source = (await api.query<{ storageKey: string }>(
        'select storage_key as "storageKey" from project_parameter_file_versions where id=$1', [fixture.sourceFileVersionId],
      )).rows[0]!;
      const path = `/api/v1/parameters/admin/projects/${fixture.projectId}`;
      const server = (objectStore: ObjectStore = store) => createWiseEffServer({ db: api, objectStore });
      const preview = await requestJson<{ item: ProjectDeletionPreview }>(server(), `${path}/deletion-preview`, { headers });
      expect(preview.status).toBe(200);
      expect(preview.body.item).toMatchObject({ blockers: [], storage: { exclusiveObjects: 1 } });
      const confirm = { method: "POST", headers, body: JSON.stringify({ stateDigest: preview.body.item.stateDigest }) };
      expect((await requestJson(server(), `${path}/purge`, { ...confirm,
        headers: { "X-WiseEff-User": fixture.editorAuth.user.id } })).status).toBe(403);
      expect((await requestJson(server(), `${path}/deletion-preview`, {
        headers: { "X-WiseEff-User": fixture.otherAuth.user.id },
      })).status).toBe(404);
      const unavailable: ObjectStore = { ...store, delete: async () => { throw new Error("Store offline"); } };
      const pending = await requestJson<{ item: ProjectDeletionStatus }>(server(unavailable), `${path}/purge`, confirm);
      expect(pending).toMatchObject({ status: 200, body: { item: {
        projectId: fixture.projectId, database: "deleted", objects: "pending", pendingObjects: 1,
      } } });
      expect((await store.get(source.storageKey)).length).toBeGreaterThan(0);
      expect(await requestJson(server(), `${path}/deletion-status`, { headers })).toMatchObject({ status: 200, body: pending.body });
      expect(await requestJson(server(), "/api/v1/parameters/admin/project-deletions", { headers })).toMatchObject({
        status: 200, body: { items: [pending.body.item] },
      });
      const finished = await requestJson<{ item: ProjectDeletionStatus }>(server(), `${path}/purge`, confirm);
      expect(finished).toMatchObject({ status: 200, body: { item: { objects: "complete", pendingObjects: 0 } } });
      await expect(store.get(source.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await requestJson(server(), `${path}/purge`, confirm)).toMatchObject({ status: 200, body: finished.body });
      expect(await requestJson(server(), `${path}/deletion-status`, { headers })).toMatchObject({ status: 200, body: finished.body });
      expect((await requestJson(server(), path, { headers })).status).toBe(404);
      expect((await requestJson(server(), `/api/v1/parameters/admin/projects/${fixture.otherProjectId}`, { headers })).status).toBe(200);
      expect((await requestJson(server(), `/api/v2/catalog/definitions/${fixture.definitionId}`, { headers })).status).toBe(200);
      expect((await requestJson(server(), "/api/v1/parameters/admin/projects", { method: "POST", headers,
        body: JSON.stringify({ name: "API LOGIN project", code: "APIPURGE" }),
      })).status).toBe(201);

      for (const relation of ["parameter_catalog.project_erasures", "parameter_catalog.parameter_definitions"] as const) {
        expect((await api.query(`select has_table_privilege(current_user,$1,'INSERT') as insert,
          has_table_privilege(current_user,$1,'UPDATE') as update,
          has_table_privilege(current_user,$1,'DELETE') as delete,
          has_table_privilege(current_user,$1,'TRUNCATE') as truncate`, [relation])).rows)
          .toEqual([{ insert: false, update: false, delete: false, truncate: false }]);
      }
      for (const connection of [runtime.workerUrl, runtime.managerUrl]) {
        const login = createPostgresDatabase(connection);
        logins.push(login);
        for (const statement of [
          "select * from parameter_catalog.preview_project_deletion_catalog($1,$2,$3)",
          "select parameter_catalog.lock_project_erasure($1,$2,$3)",
          "select parameter_catalog.read_project_erasure($1,$2,$3)",
          "select parameter_catalog.purge_project($1,$2,$3,$4)",
          "select parameter_catalog.finish_project_erasure_object($1,$2,$3,$4)",
          "select * from parameter_catalog.list_project_erasures($1,$3) where $2::text is not null",
        ]) {
          const values = [fixture.organizationId, fixture.projectId, fixture.reviewerAuth.user.id];
          if (statement.includes("$4")) values.push(preview.body.item.stateDigest);
          await expect(login.query(statement, values)).rejects.toMatchObject({ code: "42501" });
        }
      }
    } finally {
      setParameterIdentityMode(null);
      await Promise.all(logins.map(login => login.close()));
      const roles = await dropLabRuntimeLogins(database.url, runToken);
      await owner.close();
      await database.drop();
      await rm(directory, { recursive: true, force: true });
      expect(roles.failed).toEqual([]);
    }
  }, 120_000);
});
