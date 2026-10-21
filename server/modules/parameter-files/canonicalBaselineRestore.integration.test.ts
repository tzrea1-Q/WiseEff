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
import { captureConfigurationSourceState, installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createLocalObjectStore } from "../logs/objectStore";
import { listCatalogBindingRowsForProject, loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { createCanonicalValueDraft } from "../parameter-bindings/drafts/service";
import { reviewCanonicalValueChange, submitCanonicalValueChange } from "../parameter-bindings/drafts/changeService";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import type { RestorePreviewResult } from "./baselineService";
import { createBaseline } from "./baselineService";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { evaluateReleaseReadiness } from "./releaseReadinessService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import { registerDefinitionDeletionRoutes } from "../parameter-catalog-api/definitionDeletion/routes";
import { previewProjectDeletion } from "../projects/deletionPreview";
import { purgeProject } from "../projects/purge";
import { insertReleaseBaseline, insertReleaseBaselineMember, listConfigSetMemberFiles } from "./baselineRepository";

const ORG = "org-baseline-restore", PROJECT = "project-baseline-restore", USER = "user-baseline-restore";
const auth = makeTestAuthContext({ organizationId: ORG, userId: USER, roles: [{ roleId: "admin", projectId: null }] });

describe("Canonical snapshot restore through the real API role", { timeout: 120_000 }, () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  let directory: string, storage: ReturnType<typeof createLocalObjectStore>;
  let configSetId: string, fileId: string, baselineId: string, bindingId: string;
  const token = `baseline_restore_${process.pid}`;
  const target = async () => (await listCatalogBindingRowsForProject(api,auth,{ projectId: PROJECT })).find((row) => row.id === bindingId)!;
  function route(principal = auth) {
    const router = createRouter();
    registerParameterFileRoutes(router, { db: api, objectStore: storage, getCurrentAuthContext: () => principal,
      refusalAuditSink: createTrustedRefusalAuditSink(db) });
    registerDefinitionDeletionRoutes(router,{ db: api,objectStore: storage,resolveAuth: () => principal });
    return createHttpServer(router);
  }
  const path = (suffix: string) => `/api/v1/projects/${PROJECT}/baselines/${baselineId}/${suffix}`;

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("baseline-restore"); db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-baseline-restore-")); storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Snapshot restore')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Restore administrator','Admin',true),('restore-reviewer',$2,'Reviewer','Reviewer',true)", [USER, ORG]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Restore','RESTORE','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('restore-admin',$1,$2,null,'admin')", [USER, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('restore-reviewer-role','restore-reviewer',$1,$2,'software-committer')",[ORG,PROJECT]);
    await installConfigurationSourceFixture(db, auth, { subjectId: "csub_restore_json", schemaId: "restore-config",retainArtifactForErasure: true,
      additionalDefinitionWithSameName: { definitionId: "pdef_restore_retained",revisionId: "drev_restore_retained_1",propertyKey: "retained" } });
    configSetId = (await createConfigSet(db, auth, { projectId: PROJECT, name: "Restore configuration" })).id;
    const upload = await uploadProjectParameterFile(db, storage, auth, { projectId: PROJECT, fileName: "settings.json", bytes: Buffer.from('{"limit":10,"retained":7}') });
    fileId = upload.file.id;
    await addConfigSetFile(db, auth, { configSetId, fileId, role: "base", sortOrder: 0 });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published fixture is unavailable");
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, catalog, { projectId: PROJECT, configSetId, fileId,
      fileVersionId: upload.version.id, configurationSchemaId: "restore-config", rootPointer: "",
      mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" },{ definitionId: "pdef_restore_retained",pointer: "/retained" }], invocation: createUserInvocation(auth),
      requestId: "restore-json-register", refusalSink: createTrustedRefusalAuditSink(db) }));
    bindingId = (await listCatalogBindingRowsForProject(db, auth, { projectId: PROJECT })).find((row) => row.definitionId === "pdef_acme_power_iin_max")!.id;
    const gate = await evaluateReleaseReadiness(db, auth, { configSetId }, { objectStore: storage });
    expect(gate.canCreateBaseline, JSON.stringify(gate)).toBe(true);
    baselineId = (await createBaseline(db, auth, { configSetId, name: "Original configuration", gateToken: gate.gateToken,
      acknowledgedWarningIds: gate.warnings.filter((row) => row.acknowledgementRequired).map((row) => row.id) }, {}, { objectStore: storage })).id;
    const logins = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token }); api = createPostgresDatabase(logins.apiUrl);
  }, 120_000);
  afterAll(async () => {
    await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token);
    await db?.close(); await lane?.drop(); if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("offers a complete frozen JSON restore plan without changing history", async () => {
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const response = await requestJson<{ item: { canonical?: { canRestore: boolean; proofToken: string; impact: { retainedBindings: number } } } }>(route(), path("restore-preview"));
    expect(response.status, response.bodyText).toBe(200);
    expect(response.body.item.canonical).toMatchObject({ canRestore: true, proofToken: expect.any(String), impact: { retainedBindings: 2 } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect((await target()).id).toBe(bindingId);
  });

  it("atomically derives a new complete working revision, retaining the original snapshot and an idempotent receipt", async () => {
    const saved = await db.query("select * from dts_release_baseline where id=$1",[baselineId]);
    const before = await target();
    const preview = await requestJson<{ item: { canonical: { proofToken: string; sourceConfigRevisionId: string } } }>(route(),path("restore-preview"));
    const body = { proofToken: preview.body.item.canonical.proofToken,sourceConfigRevisionId: preview.body.item.canonical.sourceConfigRevisionId,
      confirmCompositionChanges: false,reason: "Restore the saved complete configuration",clientMutationId: "restore-json-once" };
    const apply = () => requestJson<{ item: { baselineId: string; configRevisionId: string } }>(route(),path("rollback"),{ method: "POST",body: JSON.stringify(body) });
    const restored = await apply();
    expect(restored.status,restored.bodyText).toBe(200);
    const after = await target();
    expect(after.id).toBe(bindingId); expect(after.currentValueId).not.toBe(before.currentValueId);
    expect(after.rawValue).toBe(before.rawValue);
    expect((await apply()).body).toEqual(restored.body);
    expect((await db.query("select * from dts_release_baseline where id=$1",[baselineId])).rows).toEqual(saved.rows);
  });

  it("restores real changed JSON values and versions, retains later members, and atomically refuses missing bytes or stale/concurrent plans", async () => {
    const current = await target();
    const pin = await loadOwnedProjectValueSourcePin(api,{ organizationId: ORG,projectId: PROJECT,bindingId,projectValueId: current.currentValueId });
    const security = { invocation: createUserInvocation(auth),requestId: "restore-edit-json",refusalSink: createTrustedRefusalAuditSink(db) };
    const draft = await createCanonicalValueDraft(api,auth,{ projectId: PROJECT,bindingId,baseRevisionId: pin!.configRevisionId,
      sourceTarget: { format: "json",sourceText: "20" },reason: "Change before restoring" },{ objectStore: storage,...security });
    const submitted = await submitCanonicalValueChange(api,auth,{ projectId: PROJECT,draftId: draft.id,...security });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(api)!);
    const reviewer = makeTestAuthContext({ organizationId: ORG,userId: "restore-reviewer",roles: [{ roleId: "software-committer",projectId: PROJECT }] });
    await reviewCanonicalValueChange(api,reviewer,{ projectId: PROJECT,requestId: submitted.id,decision: "approve" },{
      objectStore: storage,snapshot: catalog!,invocation: createUserInvocation(reviewer),traceId: "restore-edit-json-review",refusalSink: security.refusalSink });
    expect((await target()).rawValue).toBe("20\n");
    const candidate = await requestJson<{ item: { id: string } }>(route(),`/api/v1/projects/${PROJECT}/parameter-file-candidates`,{ method: "POST",
      body: JSON.stringify({ fileName: "after-snapshot.json",contentBase64: Buffer.from('{"metadata":"retain"}').toString("base64") }) });
    const addition = `/api/v1/projects/${PROJECT}/config-sets/${configSetId}/member-addition`;
    const addBody = { candidateId: candidate.body.item.id,role: "base",sortOrder: 5 };
    const addPreview = await requestJson<{ item: { proofToken: string } }>(route(),`${addition}/preview`,{ method: "POST",body: JSON.stringify(addBody) });
    expect(addPreview.status,addPreview.bodyText).toBe(200);
    const added = await requestJson(route(),`${addition}/apply`,{ method: "POST",body: JSON.stringify({ ...addBody,proofToken: addPreview.body.item.proofToken,reason: "Keep later metadata",clientMutationId: "restore-add-metadata" }) });
    expect(added.status,added.bodyText).toBe(200);
    const preview = await requestJson<{ item: RestorePreviewResult }>(route(),path("restore-preview"));
    expect(preview.status,preview.bodyText).toBe(200);
    expect(preview.body.item.canonical!.members).toContainEqual(expect.objectContaining({ fileName: "after-snapshot.json",action: "retain-added" }));
    expect(preview.body.item.canonical!.impact.parameterChanges).toBe(1);
    const body = { proofToken: preview.body.item.canonical!.proofToken,sourceConfigRevisionId: preview.body.item.canonical!.sourceConfigRevisionId,
      confirmCompositionChanges: false,reason: "Restore original JSON limits",clientMutationId: "restore-json-changed" };
    const before = await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    const objectRead = storage.getBounded!;
    storage.getBounded = async () => { throw new Error("Synthetic unavailable source object"); };
    try { expect((await requestJson(route(),path("rollback"),{ method: "POST",body: JSON.stringify(body) })).status).toBe(409); }
    finally { storage.getBounded = objectRead; }
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(before);
    await db.query(`create function public.fail_restore_approval_test() returns trigger language plpgsql as $$ begin
      if new.request_kind='configuration_restore' and new.status='approved' then raise exception 'Synthetic late restore failure'; end if; return new; end $$`);
    await db.query("create trigger fail_restore_approval_test before update on public.project_parameter_value_change_requests for each row execute function public.fail_restore_approval_test()");
    try { expect((await requestJson(route(),path("rollback"),{ method: "POST",body: JSON.stringify(body) })).status).toBe(500); }
    finally { await db.query("drop trigger fail_restore_approval_test on public.project_parameter_value_change_requests"); await db.query("drop function public.fail_restore_approval_test()"); }
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(before);
    const attempts = await Promise.all([0,1].map((index) => requestJson(route(),path("rollback"),{ method: "POST",body: JSON.stringify({ ...body,clientMutationId: `restore-race-${index}` }) })));
    expect(attempts.map((row) => row.status).sort()).toEqual([200,409]);
    expect(await target()).toMatchObject({ id: bindingId,rawValue: "10\n" });
    const exported = await requestJson<{ files: Array<{ name: string; content: string }> }>(route(),`/api/v1/projects/${PROJECT}/config-sets/${configSetId}/export`);
    expect(exported.status,exported.bodyText).toBe(200);
    expect(exported.body.files).toEqual(expect.arrayContaining([expect.objectContaining({ name: "settings.json",content: '{"limit":10,"retained":7}' }),expect.objectContaining({ name: "after-snapshot.json",content: '{"metadata":"retain"}' })]));
  });

  it("reattaches an actually saved member only with explicit composition confirmation, preserving its Binding", async () => {
    const removal = `/api/v1/projects/${PROJECT}/config-sets/${configSetId}/files/${fileId}`;
    const preview = await requestJson<{ item: { proofToken: string } }>(route(),`${removal}/removal-preview`,{ method: "POST",body: "{}" });
    expect(preview.status,preview.bodyText).toBe(200);
    const removed = await requestJson(route(),`${removal}/removal-apply`,{ method: "POST",body: JSON.stringify({ expectedProofToken: preview.body.item.proofToken,reason: "Remove before restoring saved composition",clientMutationId: "restore-remove-member" }) });
    expect(removed.status,removed.bodyText).toBe(200);
    expect(await listCatalogBindingRowsForProject(api,auth,{ projectId: PROJECT })).toHaveLength(0);
    const restorePreview = await requestJson<{ item: RestorePreviewResult }>(route(),path("restore-preview"));
    expect(restorePreview.status,restorePreview.bodyText).toBe(200);
    expect(restorePreview.body.item.canonical!.members).toContainEqual(expect.objectContaining({ fileId,action: "reattach",compositionChanged: true }));
    const body = { proofToken: restorePreview.body.item.canonical!.proofToken,sourceConfigRevisionId: restorePreview.body.item.canonical!.sourceConfigRevisionId,
      confirmCompositionChanges: false,reason: "Restore saved membership",clientMutationId: "restore-member" };
    expect((await requestJson(route(),path("rollback"),{ method: "POST",body: JSON.stringify(body) })).status).toBe(400);
    const restored = await requestJson(route(),path("rollback"),{ method: "POST",body: JSON.stringify({ ...body,confirmCompositionChanges: true }) });
    expect(restored.status,restored.bodyText).toBe(200);
    expect(await target()).toMatchObject({ id: bindingId,rawValue: "10\n" });
  });

  it("keeps legacy snapshots unchanged and requires explicit selection of actual matching historical source information",async () => {
    const id = "old-baseline-without-composition";
    await db.transaction(async (tx) => {
      await insertReleaseBaseline(tx,{ id,organizationId: ORG,configSetId,name: "Legacy saved file versions",createdByUserId: USER });
      for (const member of await listConfigSetMemberFiles(tx,configSetId)) await insertReleaseBaselineMember(tx,{
        id: `old-member-${member.fileId}`,baselineId: id,fileId: member.fileId,fileVersionId: member.currentVersionId!,versionNumber: member.currentVersionNumber! });
    });
    const url = `/api/v1/projects/${PROJECT}/baselines/${id}`;
    const incomplete = await requestJson<{ item: RestorePreviewResult }>(route(),`${url}/restore-preview`);
    expect(incomplete.status,incomplete.bodyText).toBe(200);
    expect(incomplete.body.item.canonical).toMatchObject({ canRestore: false,missingInformation: expect.arrayContaining([expect.stringContaining("未保存完整来源修订")]) });
    const actual = incomplete.body.item.canonical!.historicalRevisions[0]!;
    expect(actual).toBeDefined();
    const selected = await requestJson<{ item: RestorePreviewResult }>(route(),`${url}/restore-preview?sourceConfigRevisionId=${encodeURIComponent(actual.id)}`);
    expect(selected.status,selected.bodyText).toBe(200); expect(selected.body.item.canonical!.canRestore).toBe(true);
    const restored = await requestJson(route(),`${url}/rollback`,{ method: "POST",body: JSON.stringify({ sourceConfigRevisionId: actual.id,
      proofToken: selected.body.item.canonical!.proofToken,confirmCompositionChanges: false,reason: "Use this actual saved historical composition",clientMutationId: "restore-old-snapshot" }) });
    expect(restored.status,restored.bodyText).toBe(200);
    expect((await db.query<{ source_snapshot: unknown }>("select source_snapshot from dts_release_baseline where id=$1",[id])).rows[0]!.source_snapshot).toBeNull();
  });

  it("refuses another organization and a user lacking current administrator permission",async () => {
    const foreign = makeTestAuthContext({ organizationId: "org-foreign-restore",userId: "user-foreign-restore",roles: [{ roleId: "admin",projectId: null }] });
    expect((await requestJson(route(foreign),path("restore-preview"))).status).toBe(404);
    const reader = makeTestAuthContext({ organizationId: ORG,userId: USER,roles: [{ roleId: "guest",projectId: PROJECT }] });
    expect((await requestJson(route(reader),path("restore-preview"))).status).toBe(403);
  });

  it("erases a Definition across multi-parameter restore receipts without hiding surviving restored members or resurrecting erased parameters",async () => {
    const platform = makeTestAuthContext({ organizationId: ORG,userId: USER,roles: [{ roleId: "platform-admin",projectId: null }] });
    const path = "/api/v2/catalog/definitions/pdef_acme_power_iin_max";
    const preview = await requestJson<{ item: { previewToken: string } }>(route(platform),`${path}/deletion-preview`);
    expect(preview.status,preview.bodyText).toBe(200);
    const deleted = await requestJson(route(platform),path,{ method: "DELETE",body: JSON.stringify({ previewToken: preview.body.item.previewToken }) });
    expect(deleted.status,deleted.bodyText).toBe(200);
    const retained = await listCatalogBindingRowsForProject(api,auth,{ projectId: PROJECT });
    expect(retained).toHaveLength(1); expect(retained[0]).toMatchObject({ definitionId: "pdef_restore_retained",rawValue: "7\n" });
    const restore = await requestJson(route(),`/api/v1/projects/${PROJECT}/baselines/${baselineId}/restore-preview`);
    expect(restore.status,restore.bodyText).toBe(409); expect(restore.bodyText).toContain("不会复活");
    const exported = await requestJson<{ files: Array<{ name: string; content: string }> }>(route(),`/api/v1/projects/${PROJECT}/config-sets/${configSetId}/export`);
    expect(exported.status,exported.bodyText).toBe(200);
    expect(exported.body.files).toContainEqual(expect.objectContaining({ name: "settings.json",content: '{"limit":10,"retained":7}' }));
  });

  it("allows project erasure to remove the new restore history and snapshot metadata through the existing project owner",async () => {
    const preview = await previewProjectDeletion(api,ORG,PROJECT,USER);
    expect(preview.blockers).toEqual([]);
    const result = await purgeProject(api,createUserInvocation(auth),PROJECT,preview.stateDigest,"restore-project-erasure",storage);
    expect(result.database).toBe("deleted");
    expect((await api.query("select id from project_parameter_value_change_requests where organization_id=$1 and project_id=$2",[ORG,PROJECT])).rows).toHaveLength(0);
  });
});
