import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createProject } from "./repository";
import { createLocalObjectStore, type ObjectStore } from "../logs/objectStore";
import { makeTestAuthContext } from "../../testing/authContext";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";
import { registerCanonicalJsonSource } from "../parameter-files/canonicalJsonSource";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { insertReleaseBaseline, insertReleaseBaselineMember } from "../parameter-files/baselineRepository";
import type { ProjectDeletionPreview, ProjectDeletionStatus } from "../../../src/domain/parameters/projectDeletionPreview";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { createDebugDeviceGatewayRegistry } from "../debugging/gatewayRegistry";

describe("confirmed project purge HTTP", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let store: ObjectStore;
  const auth = makeTestAuthContext({ userId: "purge-admin", organizationId: "purge-org",
    permissions: ["parameter:view", "parameter:edit", "admin:access"] });
  beforeEach(() => setParameterIdentityMode("semantic"));
  beforeAll(async () => {
    database = await createEphemeralTestDatabase("projectpurge");
    db = createPostgresDatabase(database.url);
    setParameterIdentityMode("semantic");
    directory = await mkdtemp(join(tmpdir(), "wiseeff-project-purge-"));
    store = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ('purge-org','Purge')");
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('purge-admin','purge-org','Admin','Admin',true)");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('purge-role','purge-admin','purge-org','admin')");
    await installConfigurationSourceFixture(db, auth, { subjectId: "csub_project_purge", schemaId: "wiseeff.project.purge" });
  });
  afterAll(async () => { setParameterIdentityMode(null); await db?.close(); await database?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  const headers = { "X-WiseEff-User": "purge-admin" };
  const url = (id: string) => `/api/v1/parameters/admin/projects/${id}`;
  async function preview(id: string) {
    const response = await requestJson<{ item: ProjectDeletionPreview }>(createWiseEffServer({ db, objectStore: store }), `${url(id)}/deletion-preview`, { headers });
    expect(response.status).toBe(200);
    return response.body.item;
  }
  const purge = (id: string, digest: string, objectStore = store) => requestJson<{ item: ProjectDeletionStatus }>(
    createWiseEffServer({ db, objectStore }), `${url(id)}/purge`, { method: "POST", headers, body: JSON.stringify({ stateDigest: digest }) });
  async function canonical(id: string, limit: number, objectStore = store) {
    await createProject(db, { organizationId: "purge-org", id, name: id, code: id.toUpperCase() });
    const set = await createConfigSet(db, auth, { projectId: id, name: "Canonical" });
    const file = await uploadProjectParameterFile(db, objectStore, auth, { projectId: id, fileName: "settings.json", bytes: Buffer.from(JSON.stringify({ limit })) });
    await addConfigSetFile(db, auth, { configSetId: set.id, fileId: file.file.id, role: "base", sortOrder: 0 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture unavailable");
    const registered = await db.transaction(tx => registerCanonicalJsonSource(tx, objectStore, auth, snapshot, {
      projectId: id, configSetId: set.id, fileId: file.file.id, fileVersionId: file.version.id,
      configurationSchemaId: "wiseeff.project.purge", rootPointer: "", mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }],
      invocation: createUserInvocation(auth), requestId: id, refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const baseline = await insertReleaseBaseline(db, { id: `baseline-${id}`, organizationId: "purge-org", configSetId: set.id, name: "History", createdByUserId: "purge-admin" });
    await insertReleaseBaselineMember(db, { id: `member-${id}`, baselineId: baseline.id, fileId: file.file.id, fileVersionId: file.version.id, versionNumber: file.version.versionNumber });
    return { ...file, bindingId: registered.bindings[0]!.id };
  }
  it("requires the confirmed snapshot, deletes the project and retains an idempotent cleanup status", async () => {
    await createProject(db, { organizationId: "purge-org", id: "purge-empty", name: "Empty", code: "EMPTY" });
    const server = createWiseEffServer({ db });
    const url = "/api/v1/parameters/admin/projects/purge-empty";
    const preview = await requestJson<{ item: { stateDigest: string } }>(server, `${url}/deletion-preview`, { headers });
    expect(preview.status).toBe(200);
    const response = await requestJson(server, `${url}/purge`, {
      method: "POST", headers, body: JSON.stringify({ stateDigest: preview.body.item.stateDigest })
    });
    expect(response).toMatchObject({ status: 200, body: { item: { projectId: "purge-empty", database: "deleted", objects: "complete", pendingObjects: 0 } } });
    expect((await requestJson(server, url, { headers })).status).toBe(404);
    expect(await requestJson(server, `${url}/purge`, { method: "POST", headers, body: JSON.stringify({ stateDigest: preview.body.item.stateDigest }) })).toMatchObject({ status: 200, body: response.body });
    expect(await requestJson(server, `${url}/deletion-status`, { headers })).toMatchObject({ status: 200, body: response.body });
  });

  it("purges Canonical source, values and baselines while retaining shared objects and Catalog definitions", async () => {
    const first = await canonical("purge-canonical", 41);
    // Model a legacy deduplicating store without mutating immutable source pins.
    const retained = await canonical("purge-retained", 41, { ...store, put: async (input) => {
      const uploaded = await store.put(input);
      expect(uploaded.storageKey).not.toBe(first.version.storageKey);
      expect(uploaded.checksumSha256).toBe(first.version.checksum);
      return { ...uploaded, storageKey: first.version.storageKey };
    } });
    expect(first.version.storageKey).toBe(retained.version.storageKey);
    await db.query("insert into debug_nodes(id,organization_id,name,canonical_binding_id,canonical_project_id) values ('purge-kept-node','purge-org','Independent node',$1,'purge-canonical')", [first.bindingId]);
    const impact = await preview("purge-canonical");
    expect(impact.storage.sharedObjects).toBe(1);
    expect(impact.blockers).toEqual([]);
    expect(await purge("purge-canonical", impact.stateDigest)).toMatchObject({ status: 200, body: { item: { database: "deleted", objects: "complete" } } });
    const server = createWiseEffServer({ db, objectStore: store, debugGatewayRegistry: createDebugDeviceGatewayRegistry({}) });
    expect((await requestJson(server, url("purge-canonical"), { headers })).status).toBe(404);
    expect(await requestJson(server, url("purge-retained"), { headers })).toMatchObject({ status: 200, body: { item: { canonicalOwned: true, parameterCount: 1 } } });
    expect((await preview("purge-retained")).inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "canonical-values", count: 2 }), expect.objectContaining({ key: "baselines", count: 1 })
    ]));
    expect((await requestJson(server, "/api/v2/catalog/definitions/pdef_acme_power_iin_max", { headers })).status).toBe(200);
    expect(await requestJson(server, "/api/v1/debugging/admin/nodes", { headers })).toMatchObject({ status: 200, body: {
      items: expect.arrayContaining([expect.objectContaining({ id: "purge-kept-node", name: "Independent node" })]) } });
    expect((await store.get(retained.version.storageKey)).toString()).toBe('{"limit":41}');
  });

  it("returns durable partial status after storage failure and retries without repeating database deletion or audit", async () => {
    const owned = await canonical("purge-storage", 57);
    const impact = await preview("purge-storage");
    const unavailable: ObjectStore = { ...store, delete: async () => { throw new Error("Store offline"); } };
    expect(await purge("purge-storage", impact.stateDigest, unavailable)).toMatchObject({ status: 200, body: { item: { database: "deleted", objects: "pending", pendingObjects: 1 } } });
    const server = createWiseEffServer({ db, objectStore: store });
    expect((await requestJson(server, url("purge-storage"), { headers })).status).toBe(404);
    expect(await requestJson(server, "/api/v1/parameters/admin/project-deletions", { headers })).toMatchObject({ status: 200,
      body: { items: expect.arrayContaining([expect.objectContaining({ projectId: "purge-storage", objects: "pending" })]) } });
    expect((await store.get(owned.version.storageKey)).toString()).toBe('{"limit":57}');
    expect(await purge("purge-storage", impact.stateDigest)).toMatchObject({ status: 200, body: { item: { objects: "complete", pendingObjects: 0 } } });
    await expect(store.get(owned.version.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await db.query("select count(*)::int as count from audit_events where kind='project-purged' and target_id='purge-storage'")).rows).toEqual([{ count: 1 }]);
    await expect(uploadProjectParameterFile(db, store, auth, { projectId: "purge-storage", fileName: "late.json", bytes: Buffer.from("{}") })).rejects.toBeTruthy();
    await expect(createProject(db, { organizationId: "purge-org", id: "purge-storage", name: "Old worker", code: "OLD" })).rejects.toMatchObject({ code: "55000" });
  });

  it("requires a fresh preview and refuses ongoing configuration work", async () => {
    await createProject(db, { organizationId: "purge-org", id: "purge-stale", name: "Before", code: "STALE" });
    const impact = await preview("purge-stale");
    await db.query("update projects set name='After' where id='purge-stale'");
    expect(await purge("purge-stale", impact.stateDigest)).toMatchObject({ status: 409, body: { error: { details: { reason: "project-purge-preview-stale" } } } });
    const set = await createConfigSet(db, auth, { projectId: "purge-stale", name: "Busy" });
    await db.query("insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status) values ('purge-busy','purge-org','purge-stale',$1,1,'resolving')", [set.id]);
    const busy = await preview("purge-stale");
    expect(busy.executionAvailable).toBe(false);
    expect(await purge("purge-stale", busy.stateDigest)).toMatchObject({ status: 409, body: { error: { details: { reason: "project-purge-blocked" } } } });
  });

  it("rolls back the whole project when the audit cannot commit", async () => {
    const file = await canonical("purge-rollback", 62);
    const impact = await preview("purge-rollback");
    await db.query(`create function reject_project_purge_test() returns trigger language plpgsql as $$ begin
      if new.kind='project-purged' then raise exception 'Audit temporarily unavailable'; end if; return new; end $$;
      create trigger reject_project_purge_test before insert on audit_events for each row execute function reject_project_purge_test()`);
    try { expect((await purge("purge-rollback", impact.stateDigest)).status).toBe(500); }
    finally { await db.query("drop trigger reject_project_purge_test on audit_events; drop function reject_project_purge_test()"); }
    const after = await preview("purge-rollback");
    expect(after.stateDigest).toBe(impact.stateDigest);
    expect((await store.get(file.version.storageKey)).toString()).toBe('{"limit":62}');
    expect(await purge("purge-rollback", impact.stateDigest)).toMatchObject({ status: 200, body: { item: { objects: "complete" } } });
  });

  it("serializes concurrent confirmations and rejects cross-organization and non-admin requests", async () => {
    await createProject(db, { organizationId: "purge-org", id: "purge-concurrent", name: "Concurrent", code: "CONCURRENT" });
    const impact = await preview("purge-concurrent");
    const results = await Promise.all([purge("purge-concurrent", impact.stateDigest), purge("purge-concurrent", impact.stateDigest)]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect((await db.query("select count(*)::int as count from audit_events where kind='project-purged' and target_id='purge-concurrent'")).rows).toEqual([{ count: 1 }]);
    await db.query("insert into organizations(id,name) values ('purge-foreign','Foreign')");
    await createProject(db, { organizationId: "purge-foreign", id: "purge-foreign", name: "Foreign", code: "FOREIGN" });
    expect((await purge("purge-foreign", impact.stateDigest)).status).toBe(404);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('purge-member','purge-org','Member','User',true)");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('purge-member-role','purge-member','purge-org','software-user')");
    expect((await requestJson(createWiseEffServer({ db }), `${url("purge-stale")}/purge`, {
      method: "POST", headers: { "X-WiseEff-User": "purge-member" }, body: JSON.stringify({ stateDigest: impact.stateDigest }) })).status).toBe(403);
  });

  it("retains protected offline archives and the associated project instead of bypassing their contract", async () => {
    await createProject(db, { organizationId: "purge-org", id: "purge-protected", name: "Protected", code: "PROTECTED" });
    const object = await store.put({ organizationId: "purge-org", fileName: "offline.json", contentType: "application/json", bytes: Buffer.from('{"retained":true}') });
    await db.query(`insert into project_parameter_plane_archives(id,organization_id,project_id,scope,object_ref,content_digest,archive_digest,counts,created_by)
      values ('purge-archive','purge-org','purge-protected','legacy-parameter-plane',$1,$2,$2,'{}','purge-admin')`, [object.storageKey, `sha256:${"a".repeat(64)}`]);
    const impact = await preview("purge-protected");
    expect(impact.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: "protected-offline-archive" })]));
    expect((await purge("purge-protected", impact.stateDigest)).status).toBe(409);
    expect((await requestJson(createWiseEffServer({ db }), url("purge-protected"), { headers })).status).toBe(200);
    expect((await store.get(object.storageKey)).toString()).toBe('{"retained":true}');
  });

  it("keeps private tables inaccessible to a non-superuser runtime role while its authorized purge capability works", async () => {
    await createProject(db, { organizationId: "purge-org", id: "purge-runtime", name: "Runtime", code: "RUNTIME" });
    const impact = await preview("purge-runtime");
    await withTestClusterRoleCatalogLock(async () => {
      const client = await getRootPostgresPool(db)!.connect();
      try {
        await client.query("begin");
        await client.query("create role admin1308_runtime nologin nosuperuser");
        await client.query("grant parameter_governance_writer_role to admin1308_runtime");
        await client.query("set local role admin1308_runtime");
        await client.query("select parameter_catalog.purge_project($1,$2,$3,$4)", ["purge-org", "purge-runtime", "purge-admin", impact.stateDigest]);
        expect((await client.query("select parameter_catalog.read_project_erasure($1,$2,$3) as item", ["purge-org", "purge-runtime", "purge-admin"])).rows[0]?.item).toMatchObject({ digest: impact.stateDigest, pending: [] });
        await client.query("savepoint cross_tenant");
        await expect(client.query("select parameter_catalog.purge_project($1,$2,$3,$4)", ["purge-foreign", "purge-foreign", "purge-admin", impact.stateDigest])).rejects.toMatchObject({ code: "42501" });
        await client.query("rollback to cross_tenant");
        await expect(client.query("select * from parameter_catalog.project_parameter_values")).rejects.toMatchObject({ code: "42501" });
      } finally { await client.query("rollback"); client.release(); }
    });
  });

  it("waits for an in-flight writer, rejects its stale preview and prevents a late task from restoring deleted rows", async () => {
    await createProject(db, { organizationId: "purge-org", id: "purge-writer", name: "Writer", code: "WRITER" });
    const before = await preview("purge-writer");
    const writer = await getRootPostgresPool(db)!.connect();
    let request: ReturnType<typeof purge> | undefined;
    try {
      await writer.query("begin");
      await writer.query("insert into project_modules(id,organization_id,project_id,name) values ('purge-writer-module','purge-org','purge-writer','Concurrent module')");
      request = purge("purge-writer", before.stateDigest);
      let waiting = false;
      for (let attempt = 0; attempt < 40 && !waiting; attempt += 1) {
        waiting = (await db.query<{ waiting: boolean }>(`select exists(select 1 from pg_stat_activity where datname=current_database()
          and wait_event_type='Lock' and query like '%lock_project_erasure%') as waiting`)).rows[0]!.waiting;
        if (!waiting) await delay(20);
      }
      expect(waiting).toBe(true);
      await writer.query("commit");
      expect(await request).toMatchObject({ status: 409, body: { error: { details: { reason: "project-purge-preview-stale" } } } });
      const refreshed = await preview("purge-writer");
      expect(refreshed.inventory).toContainEqual(expect.objectContaining({ key: "modules", count: 1 }));
      expect((await purge("purge-writer", refreshed.stateDigest)).status).toBe(200);
      await expect(writer.query("insert into project_modules(id,organization_id,project_id,name) values ('purge-late-module','purge-org','purge-writer','Late task')"))
        .rejects.toMatchObject({ code: "23503" });
    } finally {
      await writer.query("rollback"); writer.release();
      await request;
    }
  });

  it("allows the normal create form to reuse a deleted project's code under a fresh identity", async () => {
    const server = createWiseEffServer({ db });
    const create = () => requestJson<{ item: { id: string; code: string } }>(server, "/api/v1/parameters/admin/projects", {
      method: "POST", headers, body: JSON.stringify({ name: "Reusable project", code: "REUSABLE" })
    });
    const first = await create();
    expect(first.status).toBe(201);
    const impact = await preview(first.body.item.id);
    expect((await purge(first.body.item.id, impact.stateDigest)).status).toBe(200);
    const next = await create();
    expect(next.status).toBe(201);
    expect(next.body.item.code).toBe("REUSABLE");
    expect(next.body.item.id).not.toBe(first.body.item.id);
    expect(await requestJson(server, "/api/v1/parameters/admin/projects", { method: "POST", headers,
      body: JSON.stringify({ id: first.body.item.id, name: "Old task", code: "EXPLICITOLD" }) })).toMatchObject({
      status: 409, body: { error: { details: { reason: "project-id-erased" } } }
    });
  });
});
