import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { captureConfigurationSourceState, installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createUserInvocation, createAgentInvocation, createSystemInvocation } from "../auth/trustedInvocation";
import { applyAdministratorMemberRemoval } from "./canonicalMemberRemoval";
import { registerCatalogProjectValueConsumerRoutes } from "../parameter-bindings/catalogProjectValueRoutes";
import { catalogMemberRemovalRequestListResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createLocalObjectStore } from "../logs/objectStore";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction, listCatalogBindingRowsForProject } from "../parameter-bindings/catalogProjectValueSync";
import { createConfigSet, addConfigSetFile, listConfigSetFiles } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import { registerDefinitionDeletionRoutes } from "../parameter-catalog-api/definitionDeletion/routes";

const ORG = "org-admin-removal", PROJECT = "project-admin-removal", USER = "user-admin-removal";
const admin = makeTestAuthContext({ organizationId: ORG, userId: USER, roles: [{ roleId: "admin", projectId: null }] });
const root = '/dts-v1/;\n// /include/ "unused-comment.dtsi"\n/ { compatible = "test,board"; model = "member removal"; };\n';
const overlay = '/dts-v1/; /plugin/;\n/ { fragment@0 { target-path = "/"; __overlay__ { note = "obsolete"; }; }; };\n';

describe("administrator Canonical member removal through the API database role", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  let directory: string, storage: ReturnType<typeof createLocalObjectStore>;
  const token = `member_remove_${process.pid}`;
  function server(auth = admin, dependencies = { db: api, storage, owner: db }) {
    const router = createRouter();
    registerParameterFileRoutes(router, { db: dependencies.db, objectStore: dependencies.storage,
      refusalAuditSink: createTrustedRefusalAuditSink(dependencies.owner), getCurrentAuthContext: () => auth });
    registerCatalogProjectValueConsumerRoutes(router, { db: dependencies.db, objectStore: dependencies.storage, getCurrentAuthContext: () => auth });
    registerDefinitionDeletionRoutes(router, { db: dependencies.db, objectStore: dependencies.storage, resolveAuth: () => auth });
    return createHttpServer(router);
  }
  const path = (set: string, file: string, op: string) => `/api/v1/projects/${PROJECT}/config-sets/${set}/files/${file}/${op}`;
  async function fixture(bound = false, mixed = false, include = false, override: boolean | "delete" = false) {
    const dependencyName = `obsolete-${crypto.randomUUID()}.dts`;
    let rootText = bound ? root.replace(" };", ' charger: charger { compatible = "acme,power"; iin_max = <36>; }; };') : root;
    if (include) rootText = rootText.replace('/dts-v1/;', `/dts-v1/;\n/include/ "${dependencyName}"`);
    const overlayText = override === "delete" ? '/dts-v1/; /plugin/;\n&charger { /delete-property/ iin_max; };\n' : override ? '/dts-v1/; /plugin/;\n&charger { iin_max = <48>; };\n' : include ? '/ { extra { note = "include dependency"; }; };' : bound ? overlay.replace('note = "obsolete";', 'backup: backup { compatible = "acme,power"; iin_max = <48>; };') : overlay;
    const configSetId = (await createConfigSet(db, admin, { projectId: PROJECT, name: `Removal ${crypto.randomUUID()}` })).id;
    const a = await uploadProjectParameterFile(db, storage, admin, { projectId: PROJECT, fileName: `board-${crypto.randomUUID()}.dts`, bytes: Buffer.from(rootText) });
    const b = await uploadProjectParameterFile(db, storage, admin, { projectId: PROJECT, fileName: dependencyName, bytes: Buffer.from(overlayText) });
    await addConfigSetFile(db, admin, { configSetId, fileId: a.file.id, role: "base", sortOrder: 0 });
    await addConfigSetFile(db, admin, { configSetId, fileId: b.file.id, role: include ? "misc" : "overlay", sortOrder: 1 });
    const c = mixed ? await uploadProjectParameterFile(db, storage, admin, { projectId: PROJECT, fileName: `settings-${crypto.randomUUID()}.json`, bytes: Buffer.from('{"unused":42}\n') }) : null;
    if (c) await addConfigSetFile(db, admin, { configSetId, fileId: c.file.id, role: "charging", sortOrder: 2 });
    const revision = await ingestConfigRevision(db, { organizationId: ORG, projectId: PROJECT, configSetId, entryFile: a.file.fileName,
      includeSearchPaths: ["."], overlayOrder: include ? [] : [b.file.fileName], members: [
        { fileId: a.file.id, fileVersionId: a.version.id, fileName: a.file.fileName, sourceName: a.file.fileName, role: "base", sortOrder: 0, content: rootText },
        { fileId: b.file.id, fileVersionId: b.version.id, fileName: b.file.fileName, sourceName: b.file.fileName, role: include ? "include" : "overlay", sortOrder: 1, content: overlayText },
        ...(c ? [{ fileId: c.file.id, fileVersionId: c.version.id, fileName: c.file.fileName, sourceName: c.file.fileName, format: "json" as const, role: "charging" as const, sortOrder: 2, content: '{"unused":42}\n' }] : [])
      ] }, admin);
    expect(revision.status).toBe("resolved");
    if (bound) {
      const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!catalog) throw new Error("Missing Catalog fixture");
      await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, { organizationId: ORG, projectId: PROJECT, configSetId, configRevisionId: revision.id }));
    }
    return { configSetId, a, b, c, revision, rootText };
  }
  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("admin-member-removal"); db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-admin-removal-")); storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Admin removal')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [USER, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('admin-removal-role',$1,$2,null,'admin')", [USER, ORG]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Admin removal','AR1304','initialized')", [PROJECT, ORG]);
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Member removal", driverName: "Acme", idempotencyKey: "member-remove-driver", reason: "Synthetic member removal test" });
    const logins = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token }); api = createPostgresDatabase(logins.apiUrl);
    expect((await api.query<{ owner: boolean }>("select current_user='catalog_migration_owner' as owner")).rows[0]!.owner).toBe(false);
  }, 120_000);
  afterAll(async () => { await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token); await db?.close(); await lane?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });

  it("previews and atomically removes a zero-Binding overlay while retaining source history", async () => {
    const f = await fixture();
    const preview = await requestJson<{ item: { proofToken: string; canApply: boolean; impact: { removedBindings: number }; dependencies: unknown[] } }>(server(), path(f.configSetId, f.b.file.id, "removal-preview"), { method: "POST", body: "{}" });
    expect(preview.status, preview.bodyText).toBe(200);
    expect(preview.body.item).toMatchObject({ canApply: true, impact: { removedBindings: 0 } });
    expect(preview.body.item.dependencies).toEqual([{ file: f.a.file.fileName, kind: "overlay", target: f.b.file.fileName }]);
    expect(await listConfigSetFiles(db, admin, { projectId: PROJECT, configSetId: f.configSetId })).toHaveLength(2);
    const applied = await requestJson(server(), path(f.configSetId, f.b.file.id, "removal-apply"), { method: "POST", body: JSON.stringify({ expectedProofToken: preview.body.item.proofToken, reason: "Remove obsolete overlay", clientMutationId: crypto.randomUUID() }) });
    expect(applied.status, applied.bodyText).toBe(200);
    expect((await listConfigSetFiles(db, admin, { projectId: PROJECT, configSetId: f.configSetId })).map((file) => file.fileId)).toEqual([f.a.file.id]);
    const history = await requestJson(server(), `/api/v1/projects/${PROJECT}/parameter-files/${f.b.file.id}/versions/${f.b.version.id}/content`);
    expect(history.status, history.bodyText).toBe(200);
    expect(history.bodyText).toBe(overlay);
  });

  it("removes a DTS member from a mixed configuration and advances every surviving current Binding", async () => {
    const f = await fixture(true, true);
    const before = (await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT })).filter((row) => [f.a.file.id, f.b.file.id].includes(row.sourceFileId!));
    expect(before).toHaveLength(2);
    const preview = await requestJson<{ item: { proofToken: string; impact: { removedBindings: number; retainedBindings: number } } }>(server(), path(f.configSetId, f.b.file.id, "removal-preview"), { method: "POST", body: "{}" });
    expect(preview.status, preview.bodyText).toBe(200);
    expect(preview.body.item.impact).toMatchObject({ removedBindings: 1, retainedBindings: 1 });
    const body = { expectedProofToken: preview.body.item.proofToken, reason: "Remove obsolete module", clientMutationId: crypto.randomUUID() };
    const result = await requestJson(server(), path(f.configSetId, f.b.file.id, "removal-apply"), { method: "POST", body: JSON.stringify(body) });
    expect(result.status, result.bodyText).toBe(200);
    const after = (await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT })).filter((row) => [f.a.file.id, f.b.file.id].includes(row.sourceFileId!));
    expect(after).toHaveLength(1);
    expect(after[0]!.currentValueId).not.toBe(before.find((row) => row.id === after[0]!.id)!.currentValueId);
    const replay = await requestJson<{ item: { replayed: boolean } }>(server(), path(f.configSetId, f.b.file.id, "removal-apply"), { method: "POST", body: JSON.stringify(body) });
    expect(replay.status, replay.bodyText).toBe(200); expect(replay.body.item.replayed).toBe(true);
    const reviews = await requestJson(server(), `/api/v2/projects/${PROJECT}/parameter-value-change-requests/member-removals?mine=true`);
    expect(reviews.status, reviews.bodyText).toBe(200);
    expect(catalogMemberRemovalRequestListResponseSchema.parse(reviews.body).items).toEqual([]);
  });

  it("removes an overriding overlay and preserves Binding identity while activating the actual fallback source", async () => {
    const f = await fixture(true, false, false, true);
    const before = (await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT })).find((row) => row.sourceFileId === f.b.file.id)!;
    expect(before.rawValue).toBe("<48>");
    const preview = await requestJson<{ item: { proofToken: string; impact: { exposedBindings: number; removedBindings: number } } }>(server(), path(f.configSetId, f.b.file.id, "removal-preview"), { method: "POST", body: "{}" });
    expect(preview.status, preview.bodyText).toBe(200); expect(preview.body.item.impact).toMatchObject({ exposedBindings: 1, removedBindings: 0 });
    const body = JSON.stringify({ expectedProofToken: preview.body.item.proofToken, reason: "Restore actual root value", clientMutationId: crypto.randomUUID() });
    const result = await requestJson<{ item: { successorConfigRevisionId: string } }>(server(), path(f.configSetId, f.b.file.id, "removal-apply"), { method: "POST", body });
    expect(result.status, result.bodyText).toBe(200);
    const after = (await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT })).find((row) => row.id === before.id)!;
    expect(after).toMatchObject({ id: before.id, definitionId: before.definitionId, logicalNodeId: before.logicalNodeId, sourceFileId: f.a.file.id, rawValue: "<36>" });
    expect(after.currentValueId).not.toBe(before.currentValueId);
    const workflow = await requestJson<{ item: { canonical: boolean } }>(server(), `/api/v1/projects/${PROJECT}/parameter-files/${f.a.file.id}/source-workflow`);
    expect(workflow.status, workflow.bodyText).toBe(200); expect(workflow.body.item.canonical).toBe(true);
    const candidate = await requestJson<{ item: { id: string } }>(server(), `/api/v1/projects/${PROJECT}/parameter-file-candidates`, { method: "POST", body: JSON.stringify({
      fileId: f.a.file.id, fileName: f.a.file.fileName, contentBase64: Buffer.from(f.rootText.replace("<36>", "<37>")).toString("base64"),
      intent: "source_revision", expectedCurrentVersionId: f.a.version.id, expectedConfigRevisionId: result.body.item.successorConfigRevisionId, clientMutationId: crypto.randomUUID()
    }) });
    expect(candidate.status, candidate.bodyText).toBe(201);
    const subsequent = await requestJson<{ item: { canSubmit: boolean; proofToken: string } }>(server(), `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);
    expect(subsequent.status, subsequent.bodyText).toBe(200); expect(subsequent.body.item.canSubmit).toBe(true);
    const edited = await requestJson(server(), `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidate.body.item.id}/source-apply`, { method: "POST", body: JSON.stringify({
      expectedCurrentVersionId: f.a.version.id, expectedProofToken: subsequent.body.item.proofToken, reason: "Edit restored source normally", clientMutationId: crypto.randomUUID()
    }) });
    expect(edited.status, edited.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api, admin, { projectId: PROJECT })).find((row) => row.id === before.id)).toMatchObject({ rawValue: "<37>", sourceFileId: f.a.file.id });
    const exported = await requestJson(server(), `/api/v1/projects/${PROJECT}/config-sets/${f.configSetId}/export`);
    expect(exported.status, exported.bodyText).toBe(200);
    const replay = await requestJson<{ item: { replayed: boolean } }>(server(), path(f.configSetId, f.b.file.id, "removal-apply"), { method: "POST", body });
    expect(replay.status, replay.bodyText).toBe(200); expect(replay.body.item.replayed).toBe(true);
  });

  it("materializes a previously hidden registered parameter when its masking overlay is removed", async () => {
    const f = await fixture(true, false, false, "delete");
    expect((await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT })).filter((row) => [f.a.file.id, f.b.file.id].includes(row.sourceFileId!))).toHaveLength(0);
    const preview = await requestJson<{ item: { proofToken: string; impact: { exposedBindings: number } } }>(server(), path(f.configSetId, f.b.file.id, "removal-preview"), { method: "POST", body: "{}" });
    expect(preview.status, preview.bodyText).toBe(200); expect(preview.body.item.impact.exposedBindings).toBe(1);
    const result = await requestJson(server(), path(f.configSetId, f.b.file.id, "removal-apply"), { method: "POST", body: JSON.stringify({ expectedProofToken: preview.body.item.proofToken, reason: "Restore the actual surviving source", clientMutationId: crypto.randomUUID() }) });
    expect(result.status, result.bodyText).toBe(200);
    const created = (await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT })).find((row) => row.sourceFileId === f.a.file.id);
    expect(created).toMatchObject({ definitionId: "pdef_acme_power_iin_max", rawValue: "<36>" });
  });

  it("rejects removal of the active root and unresolved include dependencies without any writes", async () => {
    const f = await fixture();
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const invalid = await requestJson(server(), path(f.configSetId, f.a.file.id, "removal-preview"), { method: "POST", body: "{}" });
    expect(invalid.status, invalid.bodyText).toBe(400);
    expect(invalid.bodyText).toContain("替代根文件");
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    const dependent = await fixture(false, false, true);
    const dependencyBefore = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const missingInclude = await requestJson(server(), path(dependent.configSetId, dependent.b.file.id, "removal-preview"), { method: "POST", body: "{}" });
    expect(missingInclude.status, missingInclude.bodyText).toBe(400);
    expect(missingInclude.bodyText).toContain("unresolved-source-dependency");
    expect(missingInclude.bodyText).toContain(dependent.b.file.fileName);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(dependencyBefore);
  });

  it("serializes concurrent composition confirmations and refuses a stale proof", async () => {
    const f = await fixture(false, true);
    const previews: Array<{ status: number; body: { item: { proofToken: string } } }> = [];
    for (const id of [f.b.file.id, f.c!.file.id]) previews.push(await requestJson<{ item: { proofToken: string } }>(server(), path(f.configSetId, id, "removal-preview"), { method: "POST", body: "{}" }));
    expect(previews.map((p) => p.status)).toEqual([200, 200]);
    const results = await Promise.all([f.b.file.id, f.c!.file.id].map((id, index) => requestJson(server(), path(f.configSetId, id, "removal-apply"), { method: "POST", body: JSON.stringify({
      expectedProofToken: previews[index]!.body.item.proofToken, reason: "Concurrent removal", clientMutationId: crypto.randomUUID()
    }) })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await listConfigSetFiles(db, admin, { projectId: PROJECT, configSetId: f.configSetId })).toHaveLength(2);
  });

  it("rolls back source topology, value tips, history and audit after a late database failure", async () => {
    const f = await fixture(true);
    const preview = await requestJson<{ item: { proofToken: string } }>(server(), path(f.configSetId, f.b.file.id, "removal-preview"), { method: "POST", body: "{}" });
    expect(preview.status, preview.bodyText).toBe(200);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    await db.query(`create function public.admin_removal_late_failure() returns trigger language plpgsql as $$ begin raise exception 'injected late member detach failure'; end $$;
      create trigger admin_removal_late_failure after update of config_set_id on public.project_parameter_files
      for each row when (new.config_set_id is null) execute function public.admin_removal_late_failure()`);
    try {
      const result = await requestJson(server(), path(f.configSetId, f.b.file.id, "removal-apply"), { method: "POST", body: JSON.stringify({
        expectedProofToken: preview.body.item.proofToken, reason: "Check complete rollback", clientMutationId: crypto.randomUUID()
      }) });
      expect(result.status, result.bodyText).toBe(500);
      expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    } finally { await db.query("drop trigger admin_removal_late_failure on public.project_parameter_files; drop function public.admin_removal_late_failure()"); }
  });

  it("rejects ordinary roles, foreign organizations, a wrong project and a revoked administrator", async () => {
    const f = await fixture();
    const preview = await requestJson<{ item: { proofToken: string } }>(server(), path(f.configSetId, f.b.file.id, "removal-preview"), { method: "POST", body: "{}" });
    const body = JSON.stringify({ expectedProofToken: preview.body.item.proofToken, reason: "Role check", clientMutationId: crypto.randomUUID() });
    const editor = makeTestAuthContext({ organizationId: ORG, userId: USER, roles: [{ roleId: "software-user", projectId: PROJECT }] });
    expect((await requestJson(server(editor), path(f.configSetId, f.b.file.id, "removal-preview"), { method: "POST", body: "{}" })).status).toBe(403);
    const foreign = makeTestAuthContext({ organizationId: "other-org", userId: "other-admin", roles: [{ roleId: "admin", projectId: null }] });
    expect((await requestJson(server(foreign), path(f.configSetId, f.b.file.id, "removal-preview"), { method: "POST", body: "{}" })).status).toBe(404);
    expect((await requestJson(server(), path(f.configSetId, f.b.file.id, "removal-preview").replace(PROJECT, "another-project"), { method: "POST", body: "{}" })).status).toBe(404);
    await db.query("insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('admin-removal-editor',$1,$2,$3,'software-user')", [USER, ORG, PROJECT]);
    await db.query("delete from public.user_role_bindings where user_id=$1 and role_id='admin'", [USER]);
    try { expect((await requestJson(server(), path(f.configSetId, f.b.file.id, "removal-apply"), { method: "POST", body })).status).toBe(403); }
    finally { await db.query("insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('admin-removal-role',$1,$2,null,'admin')", [USER, ORG]); }
  });

  it("refuses Agent and system source removals even with a prior human approval", async () => {
    const f = await fixture();
    const preview = await requestJson<{ item: { proofToken: string } }>(server(), path(f.configSetId, f.b.file.id, "removal-preview"), { method: "POST", body: "{}" });
    for (const invocation of [createAgentInvocation(admin, { sessionId: "removal-agent", toolCallId: "removal-tool", approval: { required: true, approvalId: "approved-before" } }),
      createSystemInvocation({ kind: "job", name: "removal-job" })]) {
      await expect(applyAdministratorMemberRemoval(api, storage, admin, { projectId: PROJECT, configSetId: f.configSetId, fileId: f.b.file.id,
        expectedProofToken: preview.body.item.proofToken, reason: "Must remain a human action", clientMutationId: crypto.randomUUID() },
      { invocation, requestId: "member-human-only", refusalSink: createTrustedRefusalAuditSink(db) })).rejects.toMatchObject({ code: "FORBIDDEN", details: { requireHuman: true } });
    }
    expect(await listConfigSetFiles(db, admin, { projectId: PROJECT, configSetId: f.configSetId })).toHaveLength(2);
  });

  it.each([false, true])("removes a registered JSON member, retaining values and history (mixed DTS: %s)", async (mixed) => {
    const jsonLane = await createEphemeralTestDatabase("admin-member-json");
    const owner = createPostgresDatabase(jsonLane.url);
    let jsonApi: ReturnType<typeof createPostgresDatabase> | undefined;
    const jsonToken = `member_json_${process.pid}`;
    try {
      await owner.query("insert into organizations(id,name) values ($1,'JSON removal')", [ORG]);
      await owner.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [USER, ORG]);
      await owner.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'JSON removal','JR1304','initialized')", [PROJECT, ORG]);
      await owner.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('json-removal-admin',$1,$2,null,'admin')", [USER, ORG]);
      await installConfigurationSourceFixture(owner, admin, { subjectId: "csub_admin_json_removal", schemaId: "wiseeff.admin-json-removal" });
      const configSetId = (await createConfigSet(owner, admin, { projectId: PROJECT, name: "JSON removal" })).id;
      const a = await uploadProjectParameterFile(owner, storage, admin, { projectId: PROJECT, fileName: "main.json", bytes: Buffer.from('{"limit":36}\n') });
      const b = await uploadProjectParameterFile(owner, storage, admin, { projectId: PROJECT, fileName: "obsolete.json", bytes: Buffer.from('{"limit":48}\n') });
      await addConfigSetFile(owner, admin, { configSetId, fileId: a.file.id, role: mixed ? "charging" : "base", sortOrder: 0 });
      await addConfigSetFile(owner, admin, { configSetId, fileId: b.file.id, role: "overlay", sortOrder: 1 });
      if (mixed) {
        const dts = await uploadProjectParameterFile(owner, storage, admin, { projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(root) });
        await addConfigSetFile(owner, admin, { configSetId, fileId: dts.file.id, role: "base", sortOrder: 2 });
        await ingestConfigRevision(owner, { organizationId: ORG, projectId: PROJECT, configSetId, entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [], members: [
          { fileId: dts.file.id, fileVersionId: dts.version.id, fileName: "board.dts", format: "dts", role: "base", sortOrder: 2, content: root },
          { fileId: a.file.id, fileVersionId: a.version.id, fileName: "main.json", format: "json", role: "charging", sortOrder: 0, content: '{"limit":36}\n' },
          { fileId: b.file.id, fileVersionId: b.version.id, fileName: "obsolete.json", format: "json", role: "overlay", sortOrder: 1, content: '{"limit":48}\n' }
        ] }, admin);
      }
      const snapshot = await loadPublishedCatalog(getRootPostgresPool(owner)!);
      if (!snapshot) throw new Error("Missing JSON Catalog");
      for (const file of [a, b]) await owner.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
        projectId: PROJECT, configSetId, fileId: file.file.id, fileVersionId: file.version.id,
        configurationSchemaId: "wiseeff.admin-json-removal", rootPointer: "", mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }],
        invocation: createUserInvocation(admin), requestId: `register:${file.file.id}`, refusalSink: createTrustedRefusalAuditSink(owner)
      }));
      const logins = await provisionPublicationRuntimeLogins(jsonLane.url, { mode: "lab", runToken: jsonToken });
      jsonApi = createPostgresDatabase(logins.apiUrl);
      const dependencies = { db: jsonApi, storage, owner };
      const preview = await requestJson<{ item: { proofToken: string; impact: { removedBindings: number; retainedBindings: number } } }>(server(admin, dependencies), path(configSetId, b.file.id, "removal-preview"), { method: "POST", body: "{}" });
      expect(preview.status, preview.bodyText).toBe(200);
      expect(preview.body.item.impact).toMatchObject({ removedBindings: 1, retainedBindings: 1 });
      const result = await requestJson(server(admin, dependencies), path(configSetId, b.file.id, "removal-apply"), { method: "POST", body: JSON.stringify({ expectedProofToken: preview.body.item.proofToken, reason: "Remove old JSON member", clientMutationId: crypto.randomUUID() }) });
      expect(result.status, result.bodyText).toBe(200);
      const values = await listCatalogBindingRowsForProject(owner, admin, { projectId: PROJECT });
      expect(values).toHaveLength(1); expect(values[0]!.sourceFileId).toBe(a.file.id); expect(values[0]!.rawValue).toContain("36");
      const history = await requestJson(server(admin, dependencies), `/api/v1/projects/${PROJECT}/parameter-files/${b.file.id}/versions/${b.version.id}/content`);
      expect(history.status).toBe(200); expect(history.bodyText).toBe('{"limit":48}\n');
    } finally { await jsonApi?.close(); await dropLabRuntimeLogins(jsonLane.url, jsonToken); await owner.close(); await jsonLane.drop(); }
  });

  it("can permanently erase a Definition after removal and fallback receipts while retaining original source", async () => {
    const sources: Array<Awaited<ReturnType<typeof fixture>>> = [];
    for (const override of [true, "delete"] as const) {
      const f = await fixture(true, false, false, override);
      sources.push(f);
      const preview = await requestJson<{ item: { proofToken: string } }>(server(), path(f.configSetId, f.b.file.id, "removal-preview"), { method: "POST", body: "{}" });
      expect(preview.status, preview.bodyText).toBe(200);
      const removed = await requestJson(server(), path(f.configSetId, f.b.file.id, "removal-apply"), { method: "POST", body: JSON.stringify({
        expectedProofToken: preview.body.item.proofToken, reason: "Prepare Definition lifecycle regression", clientMutationId: crypto.randomUUID()
      }) });
      expect(removed.status, removed.bodyText).toBe(200);
    }
    const platform = makeTestAuthContext({ organizationId: ORG, userId: USER, roles: [{ roleId: "platform-admin", projectId: null }] });
    const definitionPath = "/api/v2/catalog/definitions/pdef_acme_power_iin_max";
    const deletionPreview = await requestJson<{ item: { previewToken: string; affected: { bindings: number }; originalFilesRetained: boolean } }>(server(platform), `${definitionPath}/deletion-preview`);
    expect(deletionPreview.status, deletionPreview.bodyText).toBe(200);
    expect(deletionPreview.body.item.affected.bindings).toBeGreaterThan(0);
    expect(deletionPreview.body.item.originalFilesRetained).toBe(true);
    const deleted = await requestJson(server(platform), definitionPath, { method: "DELETE", body: JSON.stringify({ previewToken: deletionPreview.body.item.previewToken }) });
    expect(deleted.status, deleted.bodyText).toBe(200);
    expect(await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT })).toHaveLength(0);
    expect((await requestJson(server(platform), `${definitionPath}/deletion-preview`)).status).toBe(404);
    for (const f of sources) {
      const original = await requestJson(server(), `/api/v1/projects/${PROJECT}/parameter-files/${f.a.file.id}/versions/${f.a.version.id}/content`);
      expect(original.status, original.bodyText).toBe(200); expect(original.bodyText).toBe(f.rootText);
    }
  });
});
