import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { requestJson } from "../../test/testClient";
import { createWiseEffServer } from "../../app";
import { createLocalAuthService } from "../auth/localAuth";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import { createLocalObjectStore } from "../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import type { InitializationConfigSnapshot, InitializationSnapshotItemDto } from "./initializationTypes";

const ORG = "org-init-complete", SOURCE = "init-complete-source", AUTHOR = "init-complete-author", REVIEWER = "init-complete-reviewer";
const ROOT = '/dts-v1/;\r\n/include/ "private.dtsi"\r\n/ { model = "Independent original"; };\r\n';
const PRIVATE = '/ { local { status = "disabled"; }; };\r\n';
const JSON_SOURCE = '{ "untouched": [1,2], "raw": true }\r\n';
type Preview = { items: InitializationSnapshotItemDto[]; configSnapshots: InitializationConfigSnapshot[] };
type Export = { manifest: { declaredBuildInputs: unknown; preprocessing: unknown }; files: Array<{ name: string; content: string }> };
let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: ReturnType<typeof createPostgresDatabase>, runtime: ReturnType<typeof createPostgresDatabase>;
let directory: string, storage: ReturnType<typeof createLocalObjectStore>, configSetId: string;
const tokens: string[] = [], runtimeToken = `init_complete_${process.pid}`;
function api<T>(actor: number, path: string, body?: unknown, method = "POST") {
  return requestJson<T>(createWiseEffServer({ db: runtime, objectStore: storage, auth: { mode: "production" }, localAuthService: createLocalAuthService(runtime) }), path, { headers: { Authorization: `Bearer ${tokens[actor]}` },
    ...(body === undefined ? {} : { method, body: JSON.stringify(body) }) });
}
const sourcePath = () => `/api/v1/projects/${SOURCE}/config-sets/${configSetId}`;
async function objects() {
  return (await Promise.all((await readdir(directory, { recursive: true })).map(async path =>
    (await stat(join(directory, path))).isFile() ? path : null))).filter(path => path !== null).sort();
}
async function pending(targetId: string, sourceProjectId = SOURCE) {
  expect((await api(0, "/api/v1/parameters/admin/projects", { id: targetId, name: targetId, code: targetId.slice(-16).toUpperCase() })).status).toBe(201);
  const path = `/api/v1/parameters/projects/${targetId}/initialization`;
  const preview = await api<Preview>(0, `${path}/copy-preview`, { primarySourceProjectId: sourceProjectId, supplementSourceProjectIds: [] });
  expect(preview.status, preview.bodyText).toBe(200);
  const input = { projectName: targetId, projectCode: targetId.slice(-16).toUpperCase(), ownerUserId: AUTHOR,
    sourceProjectIds: [sourceProjectId], primarySourceProjectId: sourceProjectId, supplementSourceProjectIds: [], selectedModuleIds: [], selectedRisks: [],
    selectedSourceBindingIds: preview.body.items.map(row => row.sourceProjectParameterBindingId), bindingSnapshots: preview.body.items,
    sourceConfigSnapshots: preview.body.configSnapshots, emptyLibrary: false, notes: "Private fixed whole-source copy" };
  const saved = await api(0, `${path}/draft`, input, "PUT"); expect(saved.status, saved.bodyText).toBe(200);
  const submitted = await api<{ item: { id: string } }>(0, `${path}/submit`, {}); expect(submitted.status, submitted.bodyText).toBe(201);
  return { path, input, preview: preview.body, reviewId: submitted.body.item.id,
    approve: `/api/v1/parameters/admin/initialization-reviews/${submitted.body.item.id}/approve` };
}
async function bindings(projectId: string) {
  const result = await api<{ items: Array<{ id: string; currentValueId: string; configSetId: string; rawValue: string }> }>(0, `/api/v2/projects/${projectId}/parameter-bindings`);
  expect(result.status, result.bodyText).toBe(200); return result.body.items;
}
async function expectEmpty(targetId: string) {
  const files = await api<{ items: unknown[] }>(0, `/api/v1/projects/${targetId}/parameter-files`);
  expect(files.status, files.bodyText).toBe(200); expect(files.body.items).toEqual([]); expect(await bindings(targetId)).toEqual([]);
}

beforeAll(async () => {
  database = await createEphemeralTestDatabase("initcomplete"); db = createPostgresDatabase(database.url);
  directory = await mkdtemp(join(tmpdir(), "wiseeff-init-complete-")); storage = createLocalObjectStore(directory);
  await db.query("insert into organizations(id,name) values ($1,'Complete initialization')", [ORG]);
  const password = randomUUID();
  for (const id of [AUTHOR, REVIEWER]) {
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,$1,'Admin',true)", [id, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$1,$2,'admin')", [id, ORG]);
    await db.query("insert into user_password_credentials(user_id,username,password_hash) values ($1,$1,$2)", [id, await hashLocalAccountPassword(password)]);
  }
  const auth = makeTestAuthContext({ userId: AUTHOR, organizationId: ORG, roles: [{ roleId: "admin", projectId: null }] });
  await installDriverSourceFixture(db, auth, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Complete copy",
    driverName: "Frozen shared source", idempotencyKey: "complete-copy-fixture", reason: "Complete source project initialization" });
  await db.query("insert into projects(id,organization_id,name,code,status,initialization_status) values ($1,$2,'Complete source','COMPLETE','initialized','initialized')", [SOURCE, ORG]);
  configSetId = (await createConfigSet(db, auth, { projectId: SOURCE, name: "default" })).id;
  const members = [];
  for (const [index, file] of [{ fileName: "board.dts", content: ROOT, format: "dts" as const, role: "base" as const },
    { fileName: "private.dtsi", content: PRIVATE, format: "dts" as const, role: "include" as const },
    { fileName: "mixed.json", content: JSON_SOURCE, format: "json" as const, role: "thermal" as const }].entries()) {
    const uploaded = await uploadProjectParameterFile(db, storage, auth, { projectId: SOURCE, fileName: file.fileName, bytes: Buffer.from(file.content) });
    await addConfigSetFile(db, auth, { configSetId, fileId: uploaded.file.id, role: file.role === "include" ? "misc" : file.role, sortOrder: index });
    members.push({ ...file, fileId: uploaded.file.id, fileVersionId: uploaded.version.id, sortOrder: index });
  }
  const revision = await ingestConfigRevision(db, { organizationId: ORG, projectId: SOURCE, configSetId,
    entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [], members }, auth);
  const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!); if (!catalog) throw new Error("Missing fixture Catalog");
  await db.transaction(tx => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog,
    { organizationId: ORG, projectId: SOURCE, configSetId, configRevisionId: revision.id }));
  runtime = createPostgresDatabase((await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: runtimeToken })).apiUrl);
  expect((await runtime.query("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false, rolinherit: false });
  for (const username of [AUTHOR, REVIEWER]) {
    const login = await requestJson<{ token: string }>(createWiseEffServer({ db: runtime, objectStore: storage, auth: { mode: "production" }, localAuthService: createLocalAuthService(runtime) }), "/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    expect(login.status).toBe(200); tokens.push(login.body.token);
  }
}, 60_000);
afterAll(async () => { await runtime?.close(); if (database) await dropLabRuntimeLogins(database.url, runtimeToken);
  await db?.close(); await database?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });

it("copies an exact frozen shared CPP closure and all private/mixed originals with fresh independent identities", async () => {
  async function publish(input: object) {
    const draft = await api<{ item: { resourceId: string } }>(0, "/api/v2/shared-dtsi", { ...input, changeDescription: "Complete frozen source" });
    expect(draft.status, draft.bodyText).toBe(201); const id = draft.body.item.resourceId;
    const preview = await api<{ item: { id: string } }>(0, `/api/v2/shared-dtsi/${id}/publication-preview`, { expectedRevision: 1 });
    expect(preview.status, preview.bodyText).toBe(201);
    const published = await api<{ item: { resourceId: string; id: string } }>(0, `/api/v2/shared-dtsi/${id}/publications`, { previewId: preview.body.item.id, idempotencyKey: preview.body.item.id });
    expect(published.status, published.bodyText).toBe(201); return published.body.item;
  }
  const leaf = await publish({ name: "Frozen leaf", sourceName: "leaf.dtsi", content: '/ { leaf { status = "okay"; }; };\n' });
  const sharedMembers = [{ sourceName: "macro.dtsi", content: '#include <limit.h>\n#if FLAG\n/include/ "leaf.dtsi"\n/ { charger { compatible = "acme,power"; iin_max = <LIMIT>; }; };\n#endif\n' },
    { sourceName: "inc/limit.h", content: "#define LIMIT 28\n" }];
  const shared = await publish({ name: "Frozen CPP source", members: sharedMembers, buildInputs: { includeSearchPaths: ["inc"], defines: { FLAG: "1" } },
    dependencies: [{ resourceId: leaf.resourceId, versionId: leaf.id, mountPath: "" }] });
  const addition = { sharedReference: { resourceId: shared.resourceId, versionId: shared.id, mountPath: "vendor/defaults" }, role: "misc", sortOrder: 3 };
  const addPreview = await api<{ item: { proofToken: string } }>(0, `${sourcePath()}/member-addition/preview`, addition);
  expect(addPreview.status, addPreview.bodyText).toBe(200);
  const applied = await api(0, `${sourcePath()}/member-addition/apply`, { ...addition, proofToken: addPreview.body.item.proofToken,
    reason: "Complete source copy", clientMutationId: "complete-source-pin" }); expect(applied.status, applied.bodyText).toBe(200);
  const sourceBindings = await bindings(SOURCE); expect(sourceBindings.map(row => row.rawValue)).toContain("<28>");
  const sourceExport = await api<Export>(0, `${sourcePath()}/export`); expect(sourceExport.status, sourceExport.bodyText).toBe(200);
  const targetId = "init-complete-target", copy = await pending(targetId);
  expect(copy.preview.configSnapshots[0]!.members.map(row => row.sourceName)).toEqual(expect.arrayContaining(["board.dts", "private.dtsi", "mixed.json", "vendor/defaults/inc/limit.h", "vendor/defaults/leaf.dtsi"]));
  expect(copy.preview.configSnapshots[0]!.ownership).toBe("private");
  // Reading retained immutable bytes to create a private copy remains valid after retirement.
  expect((await api(0, `/api/v2/shared-dtsi/${leaf.resourceId}/lifecycle`, { state: "retired", expectedLifecycleRevision: 1, idempotencyKey: "complete-leaf-retire" })).status).toBe(200);
  expect((await api(1, copy.approve, {})).status).toBe(200);
  const targetBindings = await bindings(targetId); expect(targetBindings.map(row => row.rawValue)).toContain("<28>");
  expect(targetBindings[0]!.id).not.toBe(sourceBindings[0]!.id); expect(targetBindings[0]!.currentValueId).not.toBe(sourceBindings[0]!.currentValueId);
  const targetExport = await api<{ item: { manifest: { configSetId: string; fileId: string; fileVersionId: string; sourceOccurrenceId: string }; files: unknown[] } }>(0,
    `/api/v2/projects/${targetId}/parameter-bindings/${targetBindings[0]!.id}/export`);
  expect(targetExport.status, targetExport.bodyText).toBe(200);
  const targetSet = targetExport.body.item.manifest.configSetId;
  const exported = await api<Export>(0, `/api/v1/projects/${targetId}/config-sets/${targetSet}/export`);
  expect(exported.status, exported.bodyText).toBe(200);
  expect(exported.body.files).toEqual(sourceExport.body.files);
  expect(exported.body.manifest.preprocessing).toEqual(sourceExport.body.manifest.preprocessing);
  expect(exported.body.manifest.declaredBuildInputs).toEqual({ includeSearchPaths: [".", "vendor/defaults/inc"], defines: { FLAG: "1" } });
  const targetFiles = await api<{ items: Array<{ fileId: string; sharedReference?: unknown }> }>(0, `/api/v1/projects/${targetId}/config-sets/${targetSet}/files`);
  expect(targetFiles.status, targetFiles.bodyText).toBe(200); expect(targetFiles.body.items.every(row => !row.sharedReference)).toBe(true);
  const sourceIds = (await api<{ items: Array<{ fileId: string }> }>(0, `${sourcePath()}/files`)).body.items.map(row => row.fileId);
  expect(targetFiles.body.items.every(row => !sourceIds.includes(row.fileId))).toBe(true);
  expect((await api(1, copy.approve, {})).status).toBe(200);
  const usage = await api<{ items: Array<{ projectId: string }> }>(0, `/api/v2/shared-dtsi/${shared.resourceId}/usages`);
  expect(usage.body.items.some(row => row.projectId === targetId)).toBe(false);
  expect((await api<Export>(0, `${sourcePath()}/export`)).body.files).toEqual(sourceExport.body.files);
  expect((await api(0, `/api/v2/shared-dtsi/${leaf.resourceId}/lifecycle`, { state: "active", expectedLifecycleRevision: 2, idempotencyKey: "complete-leaf-restore" })).status).toBe(200);
  const cloned = await api<{ item: { revision: number; members: Array<{ id: string; sourceName: string; content: string }> } }>(0,
    `/api/v2/shared-dtsi/${shared.resourceId}/draft`, { baseVersionId: shared.id }); expect(cloned.status, cloned.bodyText).toBe(201);
  const changed = await api<{ item: { revision: number } }>(0, `/api/v2/shared-dtsi/${shared.resourceId}/draft`, {
    expectedRevision: cloned.body.item.revision, name: "Frozen CPP source", changeDescription: "A later source version",
    members: cloned.body.item.members.map(member => ({ ...member, content: member.sourceName === "inc/limit.h" ? "#define LIMIT 30\n" : member.content })),
    buildInputs: { includeSearchPaths: ["inc"], defines: { FLAG: "1" } }, dependencies: [{ resourceId: leaf.resourceId, versionId: leaf.id, mountPath: "" }] }, "PUT");
  expect(changed.status, changed.bodyText).toBe(200);
  const laterPreview = await api<{ item: { id: string } }>(0, `/api/v2/shared-dtsi/${shared.resourceId}/publication-preview`, { expectedRevision: changed.body.item.revision });
  expect(laterPreview.status, laterPreview.bodyText).toBe(201);
  const later = await api<{ item: { id: string } }>(0, `/api/v2/shared-dtsi/${shared.resourceId}/publications`, { previewId: laterPreview.body.item.id, idempotencyKey: "complete-later-version" });
  expect(later.status, later.bodyText).toBe(201);
  const nextReference = { ...addition, sharedReference: { ...addition.sharedReference, versionId: later.body.item.id, replaceVersionId: shared.id } };
  const nextPreview = await api<{ item: { proofToken: string } }>(0, `${sourcePath()}/member-addition/preview`, nextReference);
  expect(nextPreview.status, nextPreview.bodyText).toBe(200);
  const switched = await api(0, `${sourcePath()}/member-addition/apply`, { ...nextReference, proofToken: nextPreview.body.item.proofToken,
    reason: "Source independently follows a newer fixed version", clientMutationId: "complete-independent-source" }); expect(switched.status, switched.bodyText).toBe(200);
  expect((await bindings(SOURCE)).map(row => row.rawValue)).toContain("<30>");
  expect((await bindings(targetId)).map(row => row.rawValue)).toContain("<28>");
  expect((await api<Export>(0, `/api/v1/projects/${targetId}/config-sets/${targetSet}/export`)).body.files).toEqual(exported.body.files);
}, 120_000);

it("rolls back source objects and the transaction, then retries concurrent approval exactly once", async () => {
  const targetId = "init-atomic-target", copy = await pending(targetId), beforeObjects = await objects();
  const failed = vi.spyOn(storage, "put").mockRejectedValueOnce(new Error("Test source storage failure"));
  try { expect((await api(1, copy.approve, {})).status).toBe(500); } finally { failed.mockRestore(); }
  await expectEmpty(targetId); expect(await objects()).toEqual(beforeObjects);
  await db.query(`create function fail_complete_copy_audit() returns trigger language plpgsql as $$begin
    if new.kind='project-initialization-approved' then raise exception 'Test transaction failure'; end if; return new; end $$`);
  await db.query("create trigger fail_complete_copy_audit before insert on public.audit_events for each row execute function fail_complete_copy_audit()");
  try { expect((await api(1, copy.approve, {})).status).toBe(500); }
  finally { await db.query("drop trigger fail_complete_copy_audit on public.audit_events"); await db.query("drop function fail_complete_copy_audit()"); }
  await expectEmpty(targetId);
  expect(await objects()).toEqual(beforeObjects);
  const approvals = await Promise.all([api(1, copy.approve, {}), api(1, copy.approve, {})]);
  expect(approvals.map(row => row.status)).toEqual([200, 200]); expect(approvals[0]!.body).toEqual(approvals[1]!.body);
}, 120_000);

it("refuses foreign sources, forged previews, current permission revocation and source drift with a recoverable new preview", async () => {
  const targetId = "init-stale-target", copy = await pending(targetId);
  const foreign = await api(0, `${copy.path}/copy-preview`, { primarySourceProjectId: "foreign-project", supplementSourceProjectIds: [] });
  expect(foreign.status).toBe(403); expect(foreign.bodyText).not.toContain("Frozen CPP source");
  await db.query("delete from public.user_role_bindings where id=$1", [REVIEWER]);
  try { expect((await api(1, copy.approve, {})).status).toBe(403); } finally {
    await db.query("insert into public.user_role_bindings(id,user_id,organization_id,role_id) values ($1,$1,$2,'admin')", [REVIEWER, ORG]);
  }
  await expectEmpty(targetId);
  const extraSet = await createConfigSet(db, makeTestAuthContext({ userId: AUTHOR, organizationId: ORG, roles: [{ roleId: "admin", projectId: null }] }), { projectId: SOURCE, name: "New source configuration" });
  // Even a new empty configuration changes the approved whole-project inventory.
  expect(extraSet.id).toBeTruthy();
  const stale = await api(1, copy.approve, {}); expect(stale.status, stale.bodyText).toBe(409); await expectEmpty(targetId);
  expect((await api(1, `/api/v1/parameters/admin/initialization-reviews/${copy.reviewId}/reject`, { reason: "Refresh complete source preview" })).status).toBe(200);
  const refreshed = await api<Preview>(0, `${copy.path}/copy-preview`, { primarySourceProjectId: SOURCE, supplementSourceProjectIds: [] });
  expect(refreshed.status, refreshed.bodyText).toBe(200);
  const forged = await api(0, `${copy.path}/draft`, { ...copy.input, sourceConfigSnapshots: refreshed.body.configSnapshots.map(row => ({ ...row, digest: "0".repeat(64) })) }, "PUT");
  expect(forged.status).toBe(409);
  const saved = await api(0, `${copy.path}/draft`, { ...copy.input, bindingSnapshots: refreshed.body.items, sourceConfigSnapshots: refreshed.body.configSnapshots }, "PUT");
  expect(saved.status, saved.bodyText).toBe(200);
  const submitted = await api<{ item: { id: string } }>(0, `${copy.path}/submit`, {}); expect(submitted.status).toBe(201);
  expect((await api(1, `/api/v1/parameters/admin/initialization-reviews/${submitted.body.item.id}/approve`, {})).status).toBe(200);
}, 120_000);

it("retains genuine former-root overlay admission with fresh file identities through repeated zero-Binding project copies", async () => {
  let sourceId = "init-overlay-source";
  const auth = makeTestAuthContext({ userId: AUTHOR, organizationId: ORG, roles: [{ roleId: "admin", projectId: null }] });
  await db.query("insert into projects(id,organization_id,name,code,status,initialization_status) values ($1,$2,$1,'OVERLAY','initialized','initialized')", [sourceId, ORG]);
  const set = await createConfigSet(db, auth, { projectId: sourceId, name: "Original root composition" });
  const oldText = '/dts-v1/; / { model = "Original root"; old { retained = <1>; }; };\n';
  const currentText = '/dts-v1/; / { model = "Current root"; };\n';
  const original = await uploadProjectParameterFile(db, storage, auth, { projectId: sourceId, fileName: "original.dts", bytes: Buffer.from(oldText) });
  await addConfigSetFile(db, auth, { configSetId: set.id, fileId: original.file.id, role: "base", sortOrder: 0 });
  const oldMember = { fileId: original.file.id, fileVersionId: original.version.id, fileName: "original.dts", content: oldText, role: "base" as const, sortOrder: 0 };
  const historical = await ingestConfigRevision(db, { organizationId: ORG, projectId: sourceId, configSetId: set.id, entryFile: "original.dts", includeSearchPaths: ["."], overlayOrder: [], members: [oldMember] }, auth);
  expect(historical.status).toBe("resolved");
  const current = await uploadProjectParameterFile(db, storage, auth, { projectId: sourceId, fileName: "current.dts", bytes: Buffer.from(currentText) });
  await addConfigSetFile(db, auth, { configSetId: set.id, fileId: original.file.id, role: "overlay", sortOrder: 1 });
  await addConfigSetFile(db, auth, { configSetId: set.id, fileId: current.file.id, role: "base", sortOrder: 0 });
  const revision = await ingestConfigRevision(db, { organizationId: ORG, projectId: sourceId, configSetId: set.id, entryFile: "current.dts", includeSearchPaths: ["."], overlayOrder: ["original.dts"],
    members: [{ fileId: current.file.id, fileVersionId: current.version.id, fileName: "current.dts", content: currentText, role: "base", sortOrder: 0 }, { ...oldMember, role: "overlay", sortOrder: 1 }] }, auth);
  expect(revision.status).toBe("resolved");
  let previousIds = [original.file.id, current.file.id];
  for (const targetId of ["init-overlay-a", "init-overlay-b"]) {
    const copy = await pending(targetId, sourceId); expect(copy.preview.items).toEqual([]);
    const approved = await api(1, copy.approve, {}); expect(approved.status, approved.bodyText).toBe(200);
    const sets = await api<{ items: Array<{ id: string; name: string }> }>(0, `/api/v1/projects/${targetId}/config-sets`);
    expect(sets.status, sets.bodyText).toBe(200); const copiedSet = sets.body.items.find(row => row.name !== "default")!;
    const exported = await api<{ manifest: { validation: { ok: boolean }; sourcePackage: { formerRootOverlayFiles: string[] } }; files: unknown[] }>(0, `/api/v1/projects/${targetId}/config-sets/${copiedSet.id}/export`);
    expect(exported.status, exported.bodyText).toBe(200); expect(exported.body.manifest.validation.ok).toBe(true);
    expect(exported.body.manifest.sourcePackage.formerRootOverlayFiles).toEqual(["original.dts"]);
    expect(exported.body.files).toEqual([{ name: "current.dts", format: "dts", content: currentText }, { name: "original.dts", format: "dts", content: oldText }]);
    const files = await api<{ items: Array<{ fileId: string }> }>(0, `/api/v1/projects/${targetId}/config-sets/${copiedSet.id}/files`);
    expect(files.body.items.every(row => !previousIds.includes(row.fileId))).toBe(true);
    previousIds = files.body.items.map(row => row.fileId); sourceId = targetId;
  }
}, 60_000);
