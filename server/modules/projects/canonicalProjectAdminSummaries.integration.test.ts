import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createPostgresDatabase, getRootPostgresPool, type Queryable } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createEphemeralTestDatabase, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { projectAdminListResponseSchema, projectAdminDetailResponseSchema } from "../contracts/dtoSchemas";
import { createLocalObjectStore } from "../logs/objectStore";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { sourceBackedCommand } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { stabilizeCanonicalBinding } from "../parameter-bindings/binding/service";
import { appendProjectValue } from "../parameter-bindings/values/service";
import { ParameterDefinitionId, SubjectRegistrationId } from "../parameter-catalog-contract";
import { registerCanonicalJsonSource } from "../parameter-files/canonicalJsonSource";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";
import { insertReleaseBaseline, insertReleaseBaselineMember } from "../parameter-files/baselineRepository";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { createProject, getProjectAdminDetail, listProjectAdminSummaries } from "./repository";
import type { ProjectDeletionPreview } from "../../../src/domain/parameters/projectDeletionPreview";

const ORG = "org-canonical-project-count";
const USER = "user-canonical-project-count";
const PROJECTS = ["project-canonical-count-first", "project-canonical-count-second"];
const FOREIGN_ORG = "org-canonical-count-foreign";
const FOREIGN_PROJECT = "project-canonical-count-foreign";
const SUBJECT = "csub_canonical_project_count";
const SCHEMA = "wiseeff.project.count";
const DEFINITION = "pdef_acme_power_iin_max";

describe("canonical project admin summaries", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storageDirectory: string;
  const auth = makeTestAuthContext({ userId: USER, organizationId: ORG,
    permissions: ["parameter:view", "parameter:edit", "admin:access"] });

  const snapshotDomainRows = async (queryable: Queryable = db) => {
    const tables = (await queryable.query<{ schema: string; name: string }>(`
      select table_schema as schema, table_name as name from information_schema.tables
      where table_schema in ('public', 'parameter_catalog') and table_type = 'BASE TABLE'
        and table_name not in ('audit_events', 'platform_audit_events')
      order by table_schema, table_name
    `)).rows;
    const rows: Record<string, unknown> = {};
    for (const table of tables) {
      rows[`${table.schema}.${table.name}`] = (await queryable.query(
        `select count(*)::text as count, coalesce(jsonb_agg(to_jsonb(row) order by to_jsonb(row)::text), '[]'::jsonb) as rows from "${table.schema}"."${table.name}" row`
      )).rows;
    }
    return rows;
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("canonicalprojectcounts");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-canonical-project-count-"));
    const storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'Project counts'),($2,'Foreign')", [ORG, FOREIGN_ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Count admin','Admin',true)", [USER, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('canonical-count-admin',$1,$2,null,'admin')", [USER, ORG]);
    for (const [index, projectId] of PROJECTS.entries()) {
      await createProject(db, { organizationId: ORG, id: projectId, name: `Project ${index}`, code: `COUNT${index}` });
    }
    await createProject(db, { organizationId: FOREIGN_ORG, id: FOREIGN_PROJECT, name: "Foreign", code: "FOREIGN" });
    await installConfigurationSourceFixture(db, auth, { subjectId: SUBJECT, schemaId: SCHEMA });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published project count fixture is unavailable");
    const identities: string[] = [];
    for (const [index, projectId] of PROJECTS.entries()) {
      const configSet = await createConfigSet(db, auth, { projectId, name: "Project count JSON" });
      const uploaded = await uploadProjectParameterFile(db, storage, auth, {
        projectId, fileName: "settings.json", bytes: Buffer.from(JSON.stringify({ limit: 36.5 + index }))
      });
      await addConfigSetFile(db, auth, { configSetId: configSet.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
      const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, snapshot, {
        projectId, configSetId: configSet.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
        configurationSchemaId: SCHEMA, rootPointer: "", mappings: [{ definitionId: DEFINITION, pointer: "/limit" }],
        invocation: createUserInvocation(auth), requestId: `canonical-project-count-${index}`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
      expect(registered.bindings).toHaveLength(1);
      expect(registered.bindings[0].definitionId).toBe(DEFINITION);
      identities.push(registered.bindings[0].id);
      const baseline = await insertReleaseBaseline(db, { id: `admin1307-baseline-${index}`, organizationId: ORG,
        configSetId: configSet.id, name: "Preserved configuration history", createdByUserId: USER });
      await insertReleaseBaselineMember(db, { id: `admin1307-baseline-member-${index}`, baselineId: baseline.id,
        fileId: uploaded.file.id, fileVersionId: uploaded.version.id, versionNumber: uploaded.version.versionNumber });
    }
    expect(new Set(identities).size).toBe(2);
  }, 60_000);

  afterAll(async () => {
    setParameterIdentityMode(null);
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("previews Canonical project disposal through the API without changing any domain rows", async () => {
    const server = createWiseEffServer({ db });
    const before = await snapshotDomainRows();
    const response = await requestJson<{ item: { projectId: string; organizationId: string; stateDigest: string;
      inventory: { key: string; count: number; disposition: string }[]; executionAvailable: boolean } }>(server,
      `/api/v1/parameters/admin/projects/${PROJECTS[0]}/deletion-preview`, { headers: { "X-WiseEff-User": USER } });
    expect(response.status).toBe(200);
    expect(response.body.item).toMatchObject({ projectId: PROJECTS[0], organizationId: ORG, executionAvailable: true,
      stateDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(response.body.item.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "configurations", count: 1, disposition: "delete" }),
      expect.objectContaining({ key: "source-files", count: 1, disposition: "delete" }),
      expect.objectContaining({ key: "source-versions", count: 1, disposition: "delete" }),
      expect.objectContaining({ key: "baselines", count: 1, disposition: "delete" }),
      expect.objectContaining({ key: "baseline-members", count: 1, disposition: "delete" }),
      expect.objectContaining({ key: "canonical-bindings", count: 1, disposition: "delete" }),
      // Registration preserves the identity placeholder plus the source-backed value.
      expect.objectContaining({ key: "canonical-values", count: 2, disposition: "delete" }),
      expect.objectContaining({ key: "canonical-history", count: 1, disposition: "delete" }),
      expect.objectContaining({ key: "shared-definitions", count: 1, disposition: "retain" })
    ]));
    expect(await snapshotDomainRows()).toEqual(before);
    const again = await requestJson<typeof response.body>(server,
      `/api/v1/parameters/admin/projects/${PROJECTS[0]}/deletion-preview`, { headers: { "X-WiseEff-User": USER } });
    expect(again.body.item.stateDigest).toBe(response.body.item.stateDigest);
    expect((await requestJson(server, `/api/v1/parameters/admin/projects/${FOREIGN_PROJECT}/deletion-preview`,
      { headers: { "X-WiseEff-User": USER } })).status).toBe(404);
  });

  it("rejects a normal member before returning project impact or private counts", async () => {
    const memberId = "admin1307-preview-member";
    await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,'Member','User',true)", [memberId, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('admin1307-preview-member-role',$1,$2,'software-user')", [memberId, ORG]);
    try {
      const before = await snapshotDomainRows();
      const response = await requestJson(createWiseEffServer({ db }), `/api/v1/parameters/admin/projects/${PROJECTS[0]}/deletion-preview`,
        { headers: { "X-WiseEff-User": memberId } });
      expect(response.status).toBe(403);
      expect(await snapshotDomainRows()).toEqual(before);
    } finally {
      await db.query("delete from user_role_bindings where user_id=$1", [memberId]);
      await db.query("delete from users where id=$1", [memberId]);
    }
  });

  it("keeps private history bounded to the active administrator's organization without granting table access", async () => {
    await withTestClusterRoleCatalogLock(async () => {
      const client = await getRootPostgresPool(db)!.connect();
      try {
        await client.query("begin");
        await client.query("create role admin1307_preview_reader nologin nosuperuser");
        await client.query("grant catalog_baseline_reader_role to admin1307_preview_reader");
        await client.query("set local role admin1307_preview_reader");
        const counts = await client.query("select * from parameter_catalog.preview_project_deletion_catalog($1,$2,$3)", [ORG, PROJECTS[0], USER]);
        expect(counts.rows).toContainEqual(expect.objectContaining({ key: "canonical-values", item_count: "2" }));
        expect(counts.rows.every((row) => Object.keys(row).sort().join(",") === "item_count,key,state_digest")).toBe(true);
        expect((await client.query("select * from parameter_catalog.preview_project_deletion_catalog($1,$2,$3)",
          [ORG, FOREIGN_PROJECT, USER])).rows).toEqual([]);
        await client.query("savepoint foreign_tenant");
        await expect(client.query("select * from parameter_catalog.preview_project_deletion_catalog($1,$2,$3)",
          [FOREIGN_ORG, FOREIGN_PROJECT, USER])).rejects.toMatchObject({ code: "42501" });
        await client.query("rollback to foreign_tenant");
        await expect(client.query("select * from parameter_catalog.binding_history_events")).rejects.toMatchObject({ code: "42501" });
      } finally {
        await client.query("rollback");
        client.release();
      }
    });
  });

  it("refreshes state evidence and reports active configuration work and shared storage without exposing another project", async () => {
    const server = createWiseEffServer({ db });
    const headers = { "X-WiseEff-User": USER };
    const url = `/api/v1/parameters/admin/projects/${PROJECTS[0]}/deletion-preview`;
    const before = await requestJson<{ item: ProjectDeletionPreview }>(server, url, { headers });
    const version = (await db.query<{ storage_key: string; checksum: string; size_bytes: string }>(
      "select v.storage_key,v.checksum,v.size_bytes from project_parameter_file_versions v join project_parameter_files f on f.id=v.file_id where f.project_id=$1", [PROJECTS[0]])).rows[0]!;
    const knowledgeId = "b4b5b445-a10b-41ac-a088-f04d0525e172";
    const knowledgeFileId = "dbcc6d47-2d85-496f-b6f2-1d4e324409f8";
    const revision = (await db.query<{ config_set_id: string }>("select config_set_id from dts_config_revisions where project_id=$1", [PROJECTS[0]])).rows[0]!;
    const activeRevisionId = "admin1307-resolving-revision";
    try {
      // An independent other-tenant file legitimately reuses the stored bytes.
      await db.query(`insert into knowledge_entries(id,organization_id,title,content_form,status,source_type)
        values($1,$2,'Retained independent document','file','draft','human')`, [knowledgeId, FOREIGN_ORG]);
      await db.query(`insert into knowledge_files(id,entry_id,organization_id,storage_key,file_name,content_type,size_bytes,checksum)
        values($1,$2,$3,$4,'shared.json','application/json',$5,$6)`, [knowledgeFileId, knowledgeId, FOREIGN_ORG, version.storage_key, version.size_bytes, version.checksum]);
      await db.query(`insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status)
        values($1,$2,$3,$4,999,'resolving')`, [activeRevisionId, ORG, PROJECTS[0], revision.config_set_id]);
      const refreshed = await requestJson<{ item: ProjectDeletionPreview }>(server, url, { headers });
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.item.stateDigest).not.toBe(before.body.item.stateDigest);
      expect(refreshed.body.item.storage).toMatchObject({ exclusiveObjects: 0, sharedObjects: 1 });
      expect(refreshed.body.item.blockers).toContainEqual(expect.objectContaining({ code: "configuration-resolving", count: 1, action: expect.stringContaining("刷新") }));
      expect(JSON.stringify(refreshed.body)).not.toContain(knowledgeId);
      expect(JSON.stringify(refreshed.body)).not.toContain(FOREIGN_ORG);
      expect(JSON.stringify(refreshed.body)).not.toContain(version.storage_key);
      const foreign = await db.query("select id from knowledge_files where id=$1", [knowledgeFileId]);
      expect(foreign.rows).toEqual([{ id: knowledgeFileId }]);
    } finally {
      await db.query("delete from dts_config_revisions where id=$1", [activeRevisionId]);
      await db.query("delete from knowledge_files where id=$1", [knowledgeFileId]);
      await db.query("delete from knowledge_entries where id=$1", [knowledgeId]);
    }
  });

  it("refuses canonical project deletion with trusted audit and no domain row changes", async () => {
    setParameterIdentityMode("semantic");
    const server = createWiseEffServer({ db });
    const before = await snapshotDomainRows();
    const response = await requestJson(server, `/api/v1/parameters/admin/projects/${PROJECTS[0]}`, {
      method: "DELETE",
      headers: { "X-WiseEff-User": USER, "X-Request-Id": "canonical-project-delete-refusal" },
      body: JSON.stringify({ actorUserId: "spoofed-user", organizationId: FOREIGN_ORG })
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: "CONFLICT", requestId: "canonical-project-delete-refusal",
      details: { reason: "canonical-project-retained", projectId: PROJECTS[0] } } });
    expect(await snapshotDomainRows()).toEqual(before);
    const audit = await db.query(`select organization_id, actor_user_id, actor_type, project_id, kind, target_type,
      target_id, trace_id, metadata from audit_events where trace_id = 'canonical-project-delete-refusal'`);
    expect(audit.rows).toEqual([expect.objectContaining({ organization_id: ORG, actor_user_id: USER,
      actor_type: "user", project_id: PROJECTS[0], kind: "project-delete-refused", target_type: "project",
      target_id: PROJECTS[0], trace_id: "canonical-project-delete-refusal",
      metadata: expect.objectContaining({ initiator: "user", reason: "canonical-project-retained" }) })]);
  });

  it("still deletes an empty project through the assembled server", async () => {
    const server = createWiseEffServer({ db });
    const projectId = "canonical-count-empty-delete";
    await createProject(db, { organizationId: ORG, id: projectId, name: "Empty delete", code: "EMPTYDELETE" });
    const response = await requestJson(server, `/api/v1/parameters/admin/projects/${projectId}`, {
      method: "DELETE", headers: { "X-WiseEff-User": USER }
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect((await db.query("select id from projects where id=$1", [projectId])).rows).toEqual([]);
  });

  it("exposes tenant-scoped canonical ownership in the project operations list and detail", async () => {
    const server = createWiseEffServer({ db });
    const emptyId = "canonical-count-empty-list";
    await createProject(db, { organizationId: ORG, id: emptyId, name: "Empty list", code: "EMPTYLIST" });
    const headers = { "X-WiseEff-User": USER };
    const list = await requestJson<{ items: { id: string; canonicalOwned: boolean }[] }>(server,
      "/api/v1/parameters/admin/projects", { headers });
    expect(list.status).toBe(200);
    projectAdminListResponseSchema.parse(list.body);
    expect(list.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: PROJECTS[0], canonicalOwned: true }),
      expect.objectContaining({ id: PROJECTS[1], canonicalOwned: true }),
      expect.objectContaining({ id: emptyId, canonicalOwned: false })
    ]));
    expect(list.body.items.some((row) => row.id === FOREIGN_PROJECT)).toBe(false);
    const detail = await requestJson(server, `/api/v1/parameters/admin/projects/${PROJECTS[0]}`, { headers });
    expect(detail.status).toBe(200);
    projectAdminDetailResponseSchema.parse(detail.body);
    expect(detail.body).toMatchObject({ item: { id: PROJECTS[0], canonicalOwned: true } });
    expect((await requestJson(server, `/api/v1/parameters/admin/projects/${emptyId}`, { method: "DELETE", headers })).status).toBe(200);
  });

  it("does not expose or delete another tenant's project", async () => {
    const server = createWiseEffServer({ db });
    const response = await requestJson(server, `/api/v1/parameters/admin/projects/${FOREIGN_PROJECT}`, {
      method: "DELETE", headers: { "X-WiseEff-User": USER, "X-Request-Id": "foreign-project-delete" }
    });
    expect(response.status).toBe(404);
    expect((await db.query("select id from projects where id=$1", [FOREIGN_PROJECT])).rows).toEqual([{ id: FOREIGN_PROJECT }]);
    expect((await db.query("select id from audit_events where trace_id='foreign-project-delete'")).rows).toEqual([]);
  });

  it("counts each project's distinct JSON Binding in list and detail without initializing modules", async () => {
    setParameterIdentityMode("semantic");
    const summaries = await listProjectAdminSummaries(db, { organizationId: ORG });
    expect(summaries.map((row) => row.id)).toEqual(PROJECTS);
    for (const projectId of PROJECTS) {
      const expected = { id: projectId, parameterCount: 1, moduleCount: 0, initializationStatus: "not_initialized" };
      expect(summaries.find((row) => row.id === projectId)).toMatchObject(expected);
      expect(await getProjectAdminDetail(db, { organizationId: ORG, projectId })).toMatchObject({ ...expected, modules: [] });
    }
    expect(await getProjectAdminDetail(db, { organizationId: ORG, projectId: FOREIGN_PROJECT })).toBeNull();
    expect(await listProjectAdminSummaries(db, { organizationId: FOREIGN_ORG })).toEqual([
      expect.objectContaining({ id: FOREIGN_PROJECT, parameterCount: 0, moduleCount: 0, initializationStatus: "not_initialized" })
    ]);
  });

  it("excludes the owner's transient placeholder and real value before its source pin exists", async () => {
    setParameterIdentityMode("semantic");
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published project count fixture is unavailable");
    const definition = snapshot.getDefinitionById(ParameterDefinitionId(DEFINITION));
    if (definition.status !== "found") throw new Error("Project count Definition is unavailable");
    const registration = await db.query<{ id: string }>(
      "select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [ORG, SUBJECT]);
    const client = await getRootPostgresPool(db)!.connect();
    try {
      await client.query("begin");
      const command = await sourceBackedCommand(client, {
        snapshot, organizationId: ORG, projectId: PROJECTS[0], logicalNodeId: "count-placeholder",
        registrationId: SubjectRegistrationId(registration.rows[0].id), definitionId: ParameterDefinitionId(DEFINITION),
        effectiveRevisionId: definition.definition.selectedRevision.id, expectedEffectiveRevisionId: null
      });
      const stabilized = await stabilizeCanonicalBinding(client, command);
      if (!stabilized.ok) throw new Error(JSON.stringify(stabilized.error));
      const binding = stabilized.value.binding;
      expect((await client.query("select source_ref from parameter_catalog.project_parameter_values where id=$1", [binding.currentValueId])).rows)
        .toEqual([{ source_ref: "canonical-binding-identity" }]);
      expect(await getProjectAdminDetail(client, { organizationId: ORG, projectId: PROJECTS[0] }))
        .toMatchObject({ parameterCount: 1, moduleCount: 0, initializationStatus: "not_initialized" });
      const revision = await client.query<{ id: string }>("select id from dts_config_revisions where project_id=$1 and entry_file like 's6-%'", [PROJECTS[0]]);
      const appended = await appendProjectValue({ query: client.query.bind(client) }, {
        snapshot, binding, definitionRevisionId: binding.effectiveRevisionId,
        source: { sourceRef: "count-placeholder!/limit", configRevisionId: revision.rows[0].id },
        payload: { kind: "number", value: 5 }, expectedTip: binding.currentValueId
      });
      if (!appended.ok) throw new Error(JSON.stringify(appended.error));
      expect((await client.query("select id from parameter_catalog.project_value_source_pins where project_value_id=$1", [appended.value.currentTip])).rows).toEqual([]);
      expect(await getProjectAdminDetail(client, { organizationId: ORG, projectId: PROJECTS[0] }))
        .toMatchObject({ parameterCount: 1, moduleCount: 0, initializationStatus: "not_initialized" });
      // This owner state is reachable inside its transaction only: the deferred
      // source constraint forbids committing the real current value without a pin.
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("retains pre-cutover legacy counts while excluding residual semantic topology rows", async () => {
    await db.query(`insert into parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk)
      values ('count-legacy-definition',$1,'limit','d','e','ENV','Configuration','','mA','Low'),
             ('count-legacy-other',$1,'other','d','e','ENV','Configuration','','mA','Low')`, [ORG]);
    await db.query(`insert into project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value,value_version,updated_by_user_id)
      values ('count-legacy-first',$1,$2,'count-legacy-definition','1','1',1,$4),
             ('count-legacy-second',$1,$2,'count-legacy-other','2','2',1,$4),
             ('count-legacy-sibling',$1,$3,'count-legacy-definition','3','3',1,$4)`, [ORG, PROJECTS[0], PROJECTS[1], USER]);
    await db.query("insert into parameter_specs(id,organization_id,source_kind,specification_key) values ('count-residual-spec',$1,'manual','count/limit'),('count-residual-other',$1,'manual','count/other')", [ORG]);
    const module = await db.query<{ id: string }>("select id from parameter_modules where organization_id=$1 and name='Configuration'", [ORG]);
    await db.query(`insert into public.project_parameter_bindings(id,organization_id,project_id,logical_node_id,parameter_spec_id,module_id)
      values ('count-residual-first',$1,$2,null,'count-residual-spec',$3),('count-residual-second',$1,$2,null,'count-residual-other',$3)`, [ORG, PROJECTS[0], module.rows[0].id]);
    setParameterIdentityMode("legacy");
    expect((await listProjectAdminSummaries(db, { organizationId: ORG })).map((row) => row.parameterCount)).toEqual([2, 1]);
    expect(await getProjectAdminDetail(db, { organizationId: ORG, projectId: PROJECTS[0] })).toMatchObject({ parameterCount: 2, moduleCount: 0, initializationStatus: "not_initialized" });
    setParameterIdentityMode("semantic");
    expect((await listProjectAdminSummaries(db, { organizationId: ORG })).map((row) => row.parameterCount)).toEqual([1, 1]);
    expect(await getProjectAdminDetail(db, { organizationId: ORG, projectId: PROJECTS[0] })).toMatchObject({ parameterCount: 1, moduleCount: 0, initializationStatus: "not_initialized" });
  });

  it("rechecks canonical ownership after waiting for a concurrent source registration", async () => {
    const projectId = "canonical-count-concurrent-delete";
    const storage = createLocalObjectStore(storageDirectory);
    await createProject(db, { organizationId: ORG, id: projectId, name: "Concurrent delete", code: "CONCURRENT" });
    const configSet = await createConfigSet(db, auth, { projectId, name: "Concurrent JSON" });
    const uploaded = await uploadProjectParameterFile(db, storage, auth, {
      projectId, fileName: "settings.json", bytes: Buffer.from('{"limit":36.5}')
    });
    await addConfigSetFile(db, auth, { configSetId: configSet.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
    const pool = getRootPostgresPool(db)!;
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new Error("Published project count fixture is unavailable");
    const writer = await pool.connect();
    let deleting: ReturnType<typeof requestJson> | undefined;
    try {
      await writer.query("begin");
      const pid = (await writer.query("select pg_backend_pid() as pid")).rows[0].pid;
      await registerCanonicalJsonSource(writer, storage, auth, snapshot, {
        projectId, configSetId: configSet.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
        configurationSchemaId: SCHEMA, rootPointer: "", mappings: [{ definitionId: DEFINITION, pointer: "/limit" }],
        invocation: createUserInvocation(auth), requestId: "concurrent-project-source-register",
        refusalSink: createTrustedRefusalAuditSink(db)
      });
      const before = await snapshotDomainRows(writer);
      deleting = requestJson(createWiseEffServer({ db }), `/api/v1/parameters/admin/projects/${projectId}`, {
        method: "DELETE", headers: { "X-WiseEff-User": USER, "X-Request-Id": "concurrent-project-delete" }
      });
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        waiting = (await pool.query(`select exists(select 1 from pg_stat_activity
          where datname=current_database() and $1=any(pg_blocking_pids(pid))) as waiting`, [pid])).rows[0].waiting;
        if (!waiting) await delay(10);
      }
      expect(waiting).toBe(true);
      await writer.query("commit");
      const response = await deleting;
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ error: { details: { reason: "canonical-project-retained", projectId } } });
      expect(await snapshotDomainRows()).toEqual(before);
      expect((await db.query("select kind, actor_user_id, metadata from audit_events where trace_id='concurrent-project-delete'")).rows)
        .toEqual([expect.objectContaining({ kind: "project-delete-refused", actor_user_id: USER,
          metadata: expect.objectContaining({ initiator: "user", reason: "canonical-project-retained" }) })]);
    } finally {
      await writer.query("rollback");
      writer.release();
      await deleting;
    }
  });
});
