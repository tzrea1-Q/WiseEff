import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { captureConfigurationSourceState, installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createLocalObjectStore } from "../logs/objectStore";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import type { MemberAdditionPreview } from "./canonicalMemberAddition";
import type { SourceRevisionPreview } from "./sourceRevisionService";
import { createUserInvocation } from "../auth/trustedInvocation";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";

const ORG = "org-member-add", PROJECT = "project-member-add", ADMIN = "user-member-add";
const admin = makeTestAuthContext({ organizationId: ORG, userId: ADMIN, roles: [{ roleId: "admin", projectId: null }] });
const source = '/dts-v1/; / { compatible = "test,board"; model = "member addition"; charger: charger { compatible = "acme,power"; iin_max = <36>; }; };';

describe("Canonical member addition through the real API role", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>, directory: string, configSetId: string, baseFileId: string;
  const token = `member_add_${process.pid}`;
  function server(auth = admin) {
    const router = createRouter();
    registerParameterFileRoutes(router, { db: api, objectStore: storage, getCurrentAuthContext: () => auth,
      refusalAuditSink: createTrustedRefusalAuditSink(db) });
    return createHttpServer(router);
  }
  const post = <T,>(path: string, body: unknown, auth = admin) => requestJson<T>(server(auth), path,
    { method: "POST", body: JSON.stringify(body) });
  const path = () => `/api/v1/projects/${PROJECT}/config-sets/${configSetId}/member-addition`;
  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("member-add");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-member-add-")); storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Member addition')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Member admin','Admin',true)", [ADMIN, ORG]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Member project','MEMBERADD','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('member-add-role',$1,$2,'admin')", [ADMIN, ORG]);
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Member addition",
      driverName: "Member charger", idempotencyKey: "member-add-register", reason: "Synthetic member addition acceptance" });
    configSetId = (await createConfigSet(db, admin, { projectId: PROJECT, name: "Member addition" })).id;
    const uploaded = await uploadProjectParameterFile(db, storage, admin, { projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(source) });
    baseFileId = uploaded.file.id;
    await addConfigSetFile(db, admin, { configSetId, fileId: baseFileId, role: "base", sortOrder: 0 });
    const revision = await ingestConfigRevision(db, { organizationId: ORG, projectId: PROJECT, configSetId, entryFile: "board.dts",
      includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: baseFileId, fileVersionId: uploaded.version.id,
        fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: source }] }, admin);
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Missing member addition Catalog fixture");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot,
      { organizationId: ORG, projectId: PROJECT, configSetId, configRevisionId: revision.id }));
    const logins = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token });
    api = createPostgresDatabase(logins.apiUrl);
  }, 120_000);
  afterAll(async () => {
    await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token);
    await db?.close(); await lane?.drop(); if (directory) await rm(directory, { recursive: true, force: true });
  }, 120_000);

  it("keeps an uploaded overlay staged until its exact composition preview is confirmed", async () => {
    const before = await listCatalogBindingRowsForProject(api, admin, { projectId: PROJECT });
    expect(before).toHaveLength(1);
    const created = await post<{ item: { id: string; status: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`, {
      fileName: "limits-overlay.dts", contentBase64: Buffer.from('/dts-v1/; /plugin/; &charger { iin_max = <42>; };').toString("base64") });
    expect(created.status, created.bodyText).toBe(201);
    const body = { candidateId: created.body.item.id, role: "overlay", sortOrder: 1 };
    const preview = await post<{ item: { proofToken: string; members: unknown[]; impact: { parameterChanges: number } } }>(`${path()}/preview`, body);
    expect(preview.status, preview.bodyText).toBe(200);
    expect(preview.body.item.members).toHaveLength(2);
    expect(preview.body.item.impact.parameterChanges).toBeGreaterThan(0);
    expect((await listCatalogBindingRowsForProject(api, admin, { projectId: PROJECT }))[0]).toMatchObject({ currentValueId: before[0]!.currentValueId, rawValue: "<36>" });
    const applyBody = { ...body, proofToken: preview.body.item.proofToken, reason: "Add reviewed charger overlay", clientMutationId: "add-overlay" };
    const applied = await post<{ item: { configRevisionId: string; fileId: string } }>(`${path()}/apply`, applyBody);
    expect(applied.status, applied.bodyText).toBe(200);
    const files = await requestJson<{ items: Array<{ fileId: string }> }>(server(), `/api/v1/projects/${PROJECT}/config-sets/${configSetId}/files`);
    expect(files.body.items.map((file) => file.fileId)).toEqual(expect.arrayContaining([baseFileId, applied.body.item.fileId]));
    const after = await listCatalogBindingRowsForProject(api, admin, { projectId: PROJECT });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before[0]!.id, rawValue: "<42>" });
    expect((await post(`${path()}/apply`, applyBody)).body).toEqual(applied.body);
    const workflow = await requestJson<{ item: { canonical: boolean } }>(server(), `/api/v1/projects/${PROJECT}/parameter-files/${applied.body.item.fileId}/source-workflow`);
    expect(workflow.status, workflow.bodyText).toBe(200); expect(workflow.body.item.canonical).toBe(true);
    const edited = await post<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`, {
      fileId: applied.body.item.fileId, fileName: "limits-overlay.dts", intent: "source_revision",
      expectedCurrentVersionId: (applied.body.item as { fileVersionId?: string }).fileVersionId,
      expectedConfigRevisionId: applied.body.item.configRevisionId, clientMutationId: "edit-added-overlay",
      contentBase64: Buffer.from('/dts-v1/; /plugin/; &charger { iin_max = <43>; };').toString("base64") });
    expect(edited.status, edited.bodyText).toBe(201);
    const sourcePreview = await requestJson<{ item: SourceRevisionPreview }>(server(), `/api/v1/projects/${PROJECT}/parameter-file-candidates/${edited.body.item.id}/source-preview`);
    expect(sourcePreview.status, sourcePreview.bodyText).toBe(200);
    const committed = await post(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${edited.body.item.id}/source-apply`, {
      expectedCurrentVersionId: sourcePreview.body.item.baseVersionId, expectedProofToken: sourcePreview.body.item.proofToken,
      clientMutationId: "edit-added-overlay-apply", reason: "Edit newly joined effective source" });
    expect(committed.status, committed.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api, admin, { projectId: PROJECT }))[0]).toMatchObject({ id: before[0]!.id, rawValue: "<43>" });
    const exported = await requestJson<{ members?: unknown[] }>(server(), `/api/v1/projects/${PROJECT}/config-sets/${configSetId}/export`);
    expect(exported.status, exported.bodyText).toBe(200);
  });

  it("rejects invalid roles, unresolved references and stale previews while preserving candidates; concurrent additions have one winner", async () => {
    const uploaded = await post<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`, {
      fileName: "next-overlay.dts", contentBase64: Buffer.from('/dts-v1/; /plugin/; &charger { iin_max = <45>; };').toString("base64") });
    expect(uploaded.status).toBe(201);
    const body = { candidateId: uploaded.body.item.id, role: "overlay", sortOrder: 2 };
    expect((await post(`${path()}/preview`, { ...body, role: "unknown" })).status).toBe(400);
    expect((await post(`${path()}/preview`, { ...body, role: "base" })).status).toBe(409);
    const preview = await post<{ item: MemberAdditionPreview }>(`${path()}/preview`, body);
    expect(preview.status, preview.bodyText).toBe(200);
    const stale = await post(`${path()}/apply`, { ...body, sortOrder: 3, proofToken: preview.body.item.proofToken, clientMutationId: "stale-add", reason: "Stale composition" });
    expect(stale.status, stale.bodyText).toBe(409);
    const retained = await requestJson<{ item: { status: string; fileId?: string } }>(server(), `/api/v1/projects/${PROJECT}/parameter-file-candidates/${body.candidateId}`);
    expect(retained.body.item).toMatchObject({ status: "ready" }); expect(retained.body.item.fileId).toBeUndefined();
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('member-add-reader',$1,$2,'guest')", [ADMIN, ORG]);
    await db.query("delete from user_role_bindings where id='member-add-role'");
    try { expect((await post(`${path()}/apply`, { ...body, proofToken: preview.body.item.proofToken, clientMutationId: "revoked-add", reason: "Role was revoked" })).status).toBe(403); }
    finally { await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('member-add-role',$1,$2,'admin')", [ADMIN, ORG]); await db.query("delete from user_role_bindings where id='member-add-reader'"); }
    const results = await Promise.all(["one", "two"].map((suffix) => post(`${path()}/apply`, { ...body, proofToken: preview.body.item.proofToken,
      clientMutationId: `race-add-${suffix}`, reason: "Exactly one composition wins" })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const before = await listCatalogBindingRowsForProject(api, admin, { projectId: PROJECT });
    const unresolved = await post<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`, {
      fileName: "unresolved.dts", contentBase64: Buffer.from('/dts-v1/; /plugin/; &unknown { iin_max = <50>; };').toString("base64") });
    expect((await post(`${path()}/preview`, { candidateId: unresolved.body.item.id, role: "overlay", sortOrder: 3 })).status).toBe(400);
    expect(await listCatalogBindingRowsForProject(api, admin, { projectId: PROJECT })).toEqual(before);
    const foreign = makeTestAuthContext({ organizationId: "foreign-org", userId: "foreign-admin", roles: [{ roleId: "admin", projectId: null }] });
    expect((await post(`${path()}/preview`, body, foreign)).status).toBe(403);
  }, 120_000);
});

describe("JSON and mixed Canonical membership additions", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>, directory: string, configSetId: string;
  const organizationId = "org-json-add", projectId = "project-json-add", userId = "user-json-add", schemaId = "wiseeff.member.limits";
  const auth = makeTestAuthContext({ organizationId, userId, roles: [{ roleId: "admin", projectId: null }] });
  const token = `json_add_${process.pid}`, definitionId = "pdef_acme_power_iin_max";
  function server() {
    const router = createRouter(); registerParameterFileRoutes(router, { db: api, objectStore: storage,
      getCurrentAuthContext: () => auth, refusalAuditSink: createTrustedRefusalAuditSink(db) }); return createHttpServer(router);
  }
  const post = <T,>(path: string, body: unknown) => requestJson<T>(server(), path, { method: "POST", body: JSON.stringify(body) });
  const path = () => `/api/v1/projects/${projectId}/config-sets/${configSetId}/member-addition`;
  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("json-add"); db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-json-add-")); storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'JSON member addition')", [organizationId]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'JSON admin','Admin',true)", [userId, organizationId]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'JSON project','JSONADD','initialized')", [projectId, organizationId]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('json-add-role',$1,$2,'admin')", [userId, organizationId]);
    await installConfigurationSourceFixture(db, auth, { subjectId: "csub_member_json", schemaId });
    configSetId = (await createConfigSet(db, auth, { projectId, name: "JSON addition" })).id;
    const uploaded = await uploadProjectParameterFile(db, storage, auth, { projectId, fileName: "initial.json", bytes: Buffer.from('{"limit":10}') });
    await addConfigSetFile(db, auth, { configSetId, fileId: uploaded.file.id, role: "thermal", sortOrder: 0 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!); if (!snapshot) throw new Error("Missing JSON Catalog");
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, snapshot, { projectId, configSetId,
      fileId: uploaded.file.id, fileVersionId: uploaded.version.id, configurationSchemaId: schemaId, rootPointer: "",
      mappings: [{ definitionId, pointer: "/limit" }], invocation: createUserInvocation(auth), requestId: "json-add-initial",
      refusalSink: createTrustedRefusalAuditSink(db) }));
    const logins = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token }); api = createPostgresDatabase(logins.apiUrl);
  }, 120_000);
  afterAll(async () => { await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token); await db?.close(); await lane?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  it("adds an existing JSON file, rolls back an audit failure, then atomically joins a new DTS base to the JSON configuration", async () => {
    const existing = await uploadProjectParameterFile(db, storage, auth, { projectId, fileName: "additional.json", bytes: Buffer.from('{"limit":20}') });
    const body = { fileId: existing.file.id, role: "charging", sortOrder: 1,
      json: { configurationSchemaId: schemaId, rootPointer: "", mappings: [{ definitionId, pointer: "/limit" }] } };
    const preview = await post<{ item: MemberAdditionPreview }>(`${path()}/preview`, body);
    expect(preview.status, preview.bodyText).toBe(200);
    const before = await captureConfigurationSourceState(db, { organizationId, projectId });
    await db.query(`create function public.refuse_member_add_audit() returns trigger language plpgsql as $$begin
      if new.action='value-change-applied' and new.metadata->>'requestKind'='member_addition' then raise exception 'synthetic audit sink failure'; end if; return new; end$$;
      create trigger refuse_member_add_audit before insert on public.audit_events for each row execute function public.refuse_member_add_audit()`);
    const apply = { ...body, proofToken: preview.body.item.proofToken, reason: "Add a separate JSON instance", clientMutationId: "json-existing-add" };
    try { expect((await post(`${path()}/apply`, apply)).status).toBe(500); }
    finally { await db.query("drop trigger refuse_member_add_audit on public.audit_events; drop function public.refuse_member_add_audit()"); }
    expect(await captureConfigurationSourceState(db, { organizationId, projectId })).toEqual(before);
    const joined = await post(`${path()}/apply`, apply); expect(joined.status, joined.bodyText).toBe(200);
    const bindings = await listCatalogBindingRowsForProject(api, auth, { projectId });
    expect(bindings).toHaveLength(2); expect(bindings.map((row) => row.rawValue).sort()).toEqual(["10\n", "20\n"]);
    const staged = await post<{ item: { id: string } }>(`/api/v1/projects/${projectId}/parameter-file-candidates`, {
      fileName: "mixed-board.dts", contentBase64: Buffer.from('/dts-v1/; / { compatible = "test,mixed"; model = "mixed configuration"; };').toString("base64") });
    const mixed = { candidateId: staged.body.item.id, role: "base", sortOrder: 2 };
    const mixedPreview = await post<{ item: MemberAdditionPreview }>(`${path()}/preview`, mixed);
    expect(mixedPreview.status, mixedPreview.bodyText).toBe(200); expect(mixedPreview.body.item.members).toHaveLength(3);
    const applied = await post(`${path()}/apply`, { ...mixed, proofToken: mixedPreview.body.item.proofToken, reason: "Add mixed DTS base", clientMutationId: "mixed-base-add" });
    expect(applied.status, applied.bodyText).toBe(200);
    const after = await listCatalogBindingRowsForProject(api, auth, { projectId });
    expect(after.map((row) => row.id).sort()).toEqual(bindings.map((row) => row.id).sort());
    expect(after.map((row) => row.rawValue).sort()).toEqual(["10\n", "20\n"]);
    const newJson = await post<{ item: { id: string } }>(`/api/v1/projects/${projectId}/parameter-file-candidates`, {
      fileName: "mixed-added.json", contentBase64: Buffer.from('{"limit":30}').toString("base64") });
    const jsonBody = { candidateId: newJson.body.item.id, role: "thermal", sortOrder: 3, json: body.json };
    const jsonPreview = await post<{ item: MemberAdditionPreview }>(`${path()}/preview`, jsonBody);
    expect(jsonPreview.status, jsonPreview.bodyText).toBe(200);
    const jsonApply = await post(`${path()}/apply`, { ...jsonBody, proofToken: jsonPreview.body.item.proofToken, reason: "Join JSON into mixed configuration", clientMutationId: "mixed-json-add" });
    expect(jsonApply.status, jsonApply.bodyText).toBe(200);
    const final = await listCatalogBindingRowsForProject(api, auth, { projectId });
    expect(final.map((row) => row.rawValue).sort()).toEqual(["10\n", "20\n", "30\n"]);
    expect(final.map((row) => row.id)).toEqual(expect.arrayContaining(bindings.map((row) => row.id)));
    const invalid = await post<{ error: { code: string; message: string } }>(`/api/v1/projects/${projectId}/parameter-file-candidates`, {
      fileName: "invalid.json", contentBase64: Buffer.from('{"incomplete":').toString("base64") });
    expect(invalid.status, invalid.bodyText).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: "VALIDATION_FAILED", message: "Invalid strict JSON source." });
    expect(await listCatalogBindingRowsForProject(api, auth, { projectId })).toEqual(final);
    const unmappedSource = '{"build":{"channel":"development"},"metadata":[1,2]}';
    const unmapped = await post<{ item: { id: string } }>(`/api/v1/projects/${projectId}/parameter-file-candidates`, {
      fileName: "metadata.json", contentBase64: Buffer.from(unmappedSource).toString("base64") });
    const unmappedBody = { candidateId: unmapped.body.item.id, role: "base", sortOrder: 4 };
    const unmappedPreview = await post<{ item: MemberAdditionPreview }>(`${path()}/preview`, unmappedBody);
    expect(unmappedPreview.status, unmappedPreview.bodyText).toBe(200);
    expect(unmappedPreview.body.item.diagnostics).toContainEqual(expect.objectContaining({ code: "json-unregistered", message: expect.stringContaining("0 个新 Binding") }));
    expect(unmappedPreview.body.item.impact.parameterChanges).toBe(0);
    const unmappedApply = await post(`${path()}/apply`, { ...unmappedBody, proofToken: unmappedPreview.body.item.proofToken, reason: "Join metadata without parameter admission", clientMutationId: "metadata-json-add" });
    expect(unmappedApply.status, unmappedApply.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api, auth, { projectId })).map((row) => row.id).sort()).toEqual(final.map((row) => row.id).sort());
    const exported = await requestJson<{ files: Array<{ name: string; content: string }> }>(server(), `/api/v1/projects/${projectId}/config-sets/${configSetId}/export`);
    expect(exported.status, exported.bodyText).toBe(200);
    expect(exported.body.files.find((file) => file.name === "metadata.json")?.content).toBe(unmappedSource);
  }, 120_000);
});
