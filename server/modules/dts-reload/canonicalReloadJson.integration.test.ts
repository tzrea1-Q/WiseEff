import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTempDatabase } from "../../testing/tempDatabase";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createLocalObjectStore } from "../logs/objectStore";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { registerCanonicalJsonSource } from "../parameter-files/canonicalJsonSource";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";
import { listReloadCandidates, startReloadRun } from "./service";

it("never turns a real canonical JSON configuration Binding into a DTS overlay", async () => {
  await withTempDatabase({ prefix: "898json" }, async ({ connectionString }) => {
    const db = createPostgresDatabase(connectionString);
    const directory = await mkdtemp(join(tmpdir(), "wiseeff-898-json-"));
    try {
      const organizationId = "org-898-json";
      const projectId = "project-898-json";
      const userId = "user-898-json";
      const auth = makeTestAuthContext({ userId, organizationId });
      const storage = createLocalObjectStore(directory);
      const refusalSink = createTrustedRefusalAuditSink(db);
      await db.query("insert into organizations(id,name) values ($1,'JSON non-overlay')", [organizationId]);
      await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'JSON editor','Admin',true)", [userId, organizationId]);
      await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'JSON project','J898','initialized')", [projectId, organizationId]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('urb-898-json',$1,$2,null,'admin')", [userId, organizationId]);
      await installConfigurationSourceFixture(db, auth, { subjectId: "subject-898-json", schemaId: "wiseeff.898.settings" });
      const configSetId = (await createConfigSet(db, auth, { projectId, name: "JSON only" })).id;
      const uploaded = await uploadProjectParameterFile(db, storage, auth, {
        projectId, fileName: "settings.json", bytes: Buffer.from('{"limit":36.5}\n')
      });
      await addConfigSetFile(db, auth, { configSetId, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
      const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!snapshot) throw new Error("Published JSON fixture is unavailable");
      const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, snapshot, {
        projectId, configSetId, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
        configurationSchemaId: "wiseeff.898.settings", rootPointer: "",
        mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }],
        invocation: createUserInvocation(auth), requestId: "898-json-register", refusalSink
      }));
      expect(registered.bindings).toHaveLength(1);
      const binding = registered.bindings[0]!;
      const listed = await listReloadCandidates(db, auth, projectId);
      expect(listed.items.filter((item) => item.bindingId === binding.id && item.debuggable)).toEqual([]);
      await expect(startReloadRun(db, storage, auth, {
        projectId, targets: [{ bindingId: binding.id, debugValue: "37",
          currentValueId: binding.currentValueId, definitionRevisionId: "json-cannot-pin-dts", catalogReleaseId: snapshot.release.id }]
      }, { invocation: createUserInvocation(auth), requestId: "898-json-reload", refusalSink })).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|CONFLICT|VALIDATION_FAILED/) });
      expect((await db.query("select id from dts_reload_runs where project_id=$1", [projectId])).rows).toEqual([]);
      expect((await db.query("select id from public.project_parameter_bindings where project_id=$1", [projectId])).rows).toEqual([]);
    } finally {
      await db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}, 120_000);
