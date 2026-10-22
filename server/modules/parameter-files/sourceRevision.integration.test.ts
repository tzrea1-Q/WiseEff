import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { captureConfigurationSourceState } from "../../testing/parameterCatalog/configurationSource";
import {
  advanceSourceRevisionCatalogFixture, failBeforeSourceRevisionApproval, lockSourceRevisionRegistrations,
  readSourceRevisionBindingState, trySourceRevisionPublicationLock
} from "../../testing/parameterCatalog/sourceRevision";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createLocalObjectStore } from "../logs/objectStore";
import { asValueClient, exportCanonicalBindingSource, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction, verifyCanonicalSourceReimport } from "../parameter-bindings/catalogProjectValueSync";
import { canonicalSourceManifestSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import { activateCandidate, createCandidate, recomputeCandidateImpact } from "./candidateService";
import { freezeSourceRevisionRequest, inspectSourceRevision, isSourceRevisionReviewer, loadSourceRevisionCatalogSnapshots, previewSourceRevisionCandidate, sourceRevisionDigest, submitSourceRevisionCandidate } from "./sourceRevisionService";
import { previewCanonicalCandidate } from "./canonicalFileWorkflow";
import { commitSourceRevision } from "./sourceRevisionCommit";
import { createSourceAdminFixture, sourceAdminText, sourceAdminToolchain } from "./sourceAdministration.testHelpers";
import { readOwnedCurrentBinding, appendProjectValue } from "../parameter-bindings/values";
import { ProjectValueId } from "../parameter-catalog-contract";

const ORG = "org-source-revision";
const PROJECT = "project-source-revision";
const ADMIN = "user-source-editor";
const REVIEWER = "user-source-reviewer";
const base = `/dts-v1/;\n/ {\n compatible = "test,board"; model = "source editor";\n charger: charger { compatible = "acme,power"; iin_max = <36>; };\n};\n`;
const editor = makeTestAuthContext({ organizationId: ORG, userId: ADMIN,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"], roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ organizationId: ORG, userId: REVIEWER,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }, { roleId: "software-committer", projectId: PROJECT }] });

// Cases intentionally run several independent real compiler invocations and
// concurrent commits, matching the existing native source-workflow budget.
describe("whole DTS source revisions (native PostgreSQL and toolchain)", { timeout: 120_000 }, () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let directory: string;
  let fileId: string;
  let configSetId: string;
  let versionId: string;
  let revisionId: string;
  let bindingId: string;
  let runtime: ReturnType<typeof createPostgresDatabase>;
  const runtimeToken = `source_editor_${process.pid}`;

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("source-revision");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-source-revision-"));
    storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Source editor')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Editor','Admin',true),($3,$2,'Reviewer','Admin',true)", [ADMIN, ORG, REVIEWER]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Source revisions','SRCREV','initialized')", [PROJECT, ORG]);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
      ('source-editor-admin',$1,$2,null,'admin'),('source-reviewer-admin',$3,$2,null,'admin'),
      ('source-reviewer-role',$3,$2,$4,'software-committer')`, [ADMIN, ORG, REVIEWER, PROJECT]);
    await installDriverSourceFixture(db, editor, { subjectId: "csub_acme_power", compatible: "acme,power",
      businessName: "Source editor", driverName: "Acme power", idempotencyKey: "source-revision-registration", reason: "Synthetic source editor acceptance" });
    const config = await createConfigSet(db, editor, { projectId: PROJECT, name: "Source editing" });
    configSetId = config.id;
    const uploaded = await uploadProjectParameterFile(db, storage, editor, { projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(base) });
    fileId = uploaded.file.id;
    versionId = uploaded.version.id;
    await addConfigSetFile(db, editor, { configSetId, fileId, role: "base", sortOrder: 0 });
    const revision = await ingestConfigRevision(db, { organizationId: ORG, projectId: PROJECT, configSetId,
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId, fileVersionId: versionId,
        fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: base }] }, editor);
    revisionId = revision.id;
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    expect(catalog).not.toBeNull();
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog!, {
      organizationId: ORG, projectId: PROJECT, configSetId, configRevisionId: revisionId }));
    const bindings = await listCatalogBindingRowsForProject(db, editor, { projectId: PROJECT });
    expect(bindings).toHaveLength(1);
    bindingId = bindings[0]!.id;
    const logins = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: runtimeToken });
    runtime = createPostgresDatabase(logins.apiUrl);
  }, 120_000);

  afterAll(async () => {
    await runtime?.close();
    if (lane) await dropLabRuntimeLogins(lane.url, runtimeToken);
    await db?.close();
    await lane?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function candidate(text: string, key: string) {
    return createCandidate(runtime, storage, editor, { projectId: PROJECT, fileId, fileName: "board.dts", bytes: Buffer.from(text),
      intent: "source_revision", expectedCurrentVersionId: versionId, expectedConfigRevisionId: revisionId, clientMutationId: key });
  }
  async function submit(text: string, key: string) {
    const staged = await candidate(text, key);
    const preview = await previewSourceRevisionCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: staged.id });
    expect(preview.canSubmit).toBe(true);
    const input = { projectId: PROJECT, candidateId: staged.id, expectedCurrentVersionId: versionId,
      expectedProofToken: preview.proofToken, reason: "Review full source", assignedToUserId: REVIEWER, clientMutationId: `${key}-submit` };
    const security = { invocation: createUserInvocation(editor), requestId: `${key}-trace`, refusalSink: createTrustedRefusalAuditSink(db) };
    const request = await submitSourceRevisionCandidate(runtime, storage, editor, input, security);
    expect(await submitSourceRevisionCandidate(runtime, storage, editor, input, security)).toEqual({ ...request, replayed: true });
    return { request, preview, staged };
  }
  async function approve(requestId: string) {
    const catalog = await loadPublishedCatalog(getRootPostgresPool(runtime)!);
    const catalogSnapshots = await loadSourceRevisionCatalogSnapshots(runtime, PROJECT, ORG, catalog);
    const concurrent = await Promise.all([0, 1].map(() => runtime.transaction((tx) => commitSourceRevision(tx, storage, reviewer, catalog, {
      projectId: PROJECT, requestId, invocation: createUserInvocation(reviewer), traceId: `${requestId}-approve`, refusalSink: createTrustedRefusalAuditSink(db), catalogSnapshots }))));
    const result = concurrent[0]!;
    expect(concurrent[1]).toEqual(result);
    const receipt = (await db.query<{ applied_source_result: { fileVersionId: string; configRevisionId: string } }>(
      "select applied_source_result from project_parameter_value_change_requests where id=$1", [requestId])).rows[0]!.applied_source_result;
    versionId = receipt.fileVersionId;
    revisionId = receipt.configRevisionId;
    expect(await runtime.transaction((tx) => commitSourceRevision(tx, storage, reviewer, catalog, {
      projectId: PROJECT, requestId, invocation: createUserInvocation(reviewer), traceId: `${requestId}-retry`, refusalSink: createTrustedRefusalAuditSink(db), catalogSnapshots }))).toEqual(result);
    return receipt;
  }

  it("applies comments with zero targets and preserves Binding identity and equal business values", async () => {
    const current = await listCatalogBindingRowsForProject(db, editor, { projectId: PROJECT });
    const text = base.replace("/ {", "/ {\n /* only a source comment */");
    const duplicates = await Promise.all([candidate(text, "comments"), candidate(text, "comments")]);
    expect(duplicates[0]!.id).toBe(duplicates[1]!.id);
    const { request, preview, staged } = await submit(text, "comments");
    expect(preview.impact.parameterChanges).toBe(0);
    expect(preview.reviewers).toContainEqual({ userId: REVIEWER, name: "Reviewer" });
    expect((await db.query("select id from project_parameter_value_change_targets where request_id=$1", [request.requestId])).rows).toHaveLength(0);
    expect(await candidate(text, "comments")).toMatchObject({ id: staged.id });
    await expect(candidate(text + "\n", "comments")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(activateCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: staged.id, expectedCurrentVersionId: versionId })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source-revision-workflow-required" } });
    await expect(recomputeCandidateImpact(runtime, storage, editor, { projectId: PROJECT, candidateId: staged.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(previewCanonicalCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: staged.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await db.query("delete from user_role_bindings where id='source-reviewer-admin'");
    expect(await isSourceRevisionReviewer(runtime, reviewer, PROJECT)).toBe(false);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(runtime)!);
    await expect(runtime.transaction((tx) => commitSourceRevision(tx, storage, reviewer, catalog, {
      projectId: PROJECT, requestId: request.requestId, invocation: createUserInvocation(reviewer), traceId: "revoked-admin",
      refusalSink: createTrustedRefusalAuditSink(db) }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('source-reviewer-admin',$1,$2,null,'admin')", [REVIEWER, ORG]);
    await db.query("delete from user_role_bindings where id='source-reviewer-role'");
    expect(await isSourceRevisionReviewer(runtime, reviewer, PROJECT)).toBe(true);
    await approve(request.requestId);
    const after = await listCatalogBindingRowsForProject(db, editor, { projectId: PROJECT });
    expect(after[0]!.id).toBe(bindingId);
    expect(after[0]!.rawValue).toBe(current[0]!.rawValue);
    const version = (await db.query<{ storage_key: string }>("select storage_key from project_parameter_file_versions where id=$1", [versionId])).rows[0]!;
    expect((await storage.get(version.storage_key)).toString("utf8")).toBe(text);
  });

  it("validates the complete pinned scalar schema before opening a review", async () => {
    for (const [key, value] of [["wrong-scalar", '"wrong type"'], ["negative-scalar", "<(-1)>"]] as const) {
      const staged = await candidate(base.replace("<36>", value), key);
      await expect(previewSourceRevisionCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: staged.id })).rejects.toMatchObject({
        code: "VALIDATION_FAILED", details: { reason: expect.stringMatching(/definition-value-constraint|schema-failed/) }
      });
    }
    expect((await db.query("select id from project_parameter_value_change_requests where status='pending'")).rows).toHaveLength(0);
  });

  it("keeps pinned Binding releases usable after publication and fences concurrent governance writes", async () => {
    const current = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!current) throw new Error("Catalog fixture unavailable");
    expect(await advanceSourceRevisionCatalogFixture(db, current.release)).toMatchObject({ ok: true });
    const staged = await candidate(base + "/* after publication */\n", "historical-binding-release");
    const preview = await previewSourceRevisionCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: staged.id });
    expect(preview.impact.parameterChanges).toBe(0);
    const published = await loadPublishedCatalog(getRootPostgresPool(runtime)!);
    const snapshots = await loadSourceRevisionCatalogSnapshots(runtime, PROJECT, ORG, published);
    expect(snapshots.size).toBe(2);
    const observer = await getRootPostgresPool(db)!.connect();
    try {
      await runtime.transaction(async (tx) => {
        await inspectSourceRevision(tx, storage, editor, { projectId: PROJECT, candidateId: staged.id }, published, { lock: true, snapshots });
        await observer.query("begin");
        expect(await trySourceRevisionPublicationLock(observer)).toBe(false);
        await expect(lockSourceRevisionRegistrations(observer)).rejects.toMatchObject({ code: "55P03" });
        await observer.query("rollback");
      });
      await observer.query("begin");
      expect(await trySourceRevisionPublicationLock(observer)).toBe(true);
      await lockSourceRevisionRegistrations(observer);
      await observer.query("rollback");
    } finally { await observer.query("rollback").catch(() => undefined); observer.release(); }
    const { request } = await submit(base + "/* preserve historical Binding */\n", "historical-binding-apply");
    await approve(request.requestId);
    expect((await readSourceRevisionBindingState(db, { organizationId: ORG, projectId: PROJECT, bindingId })).catalogReleaseId).toBe(current.release.id);
  });

  it("reviews bound values, unregistered properties and added nodes in one exact source revision", async () => {
    const text = base.replace("<36>", "<42>").replace("\n};", '\n unregistered { list = "", "same", "same"; };\n extra: charger2 { compatible = "acme,power"; iin_max = <40>; };\n};');
    const { request, preview } = await submit(text, "structure-and-values");
    expect(preview.impact).toMatchObject({ parameterChanges: 2, nodeAdditions: 2 });
    await approve(request.requestId);
    const bindings = await listCatalogBindingRowsForProject(db, editor, { projectId: PROJECT });
    expect(bindings).toHaveLength(2);
    expect(bindings.find((row) => row.id === bindingId)?.rawValue).toBe("<42>");
    expect(bindings.some((row) => row.rawValue === "<40>")).toBe(true);
  });

  it("rejects forged context and rolls back late apply and storage failures", async () => {
    const { request, staged } = await submit(base.replace("<36>", "<43>"), "faulted-apply");
    const catalog = await loadPublishedCatalog(getRootPostgresPool(runtime)!);
    const catalogSnapshots = await loadSourceRevisionCatalogSnapshots(runtime, PROJECT, ORG, catalog);
    const readState = () => captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const initial = await readState();
    const input = { projectId: PROJECT, requestId: request.requestId, invocation: createUserInvocation(reviewer),
      traceId: "fault-injected-apply", refusalSink: createTrustedRefusalAuditSink(db), catalogSnapshots };
    await expect(runtime.transaction((tx) => commitSourceRevision(tx, { ...storage, getBounded: async () => { throw new Error("object-store-unavailable"); } },
      reviewer, catalog, input))).rejects.toThrow("object-store-unavailable");
    expect(await readState()).toEqual(initial);
    await expect(runtime.transaction((tx) => commitSourceRevision(failBeforeSourceRevisionApproval(tx, request.requestId),
      storage, reviewer, catalog, input))).rejects.toThrow("late-apply-failure");
    expect(await readState()).toEqual(initial);
    await expect(db.transaction(async (tx) => {
      await tx.query(`update project_parameter_value_change_requests set source_revision_context=jsonb_set(source_revision_context,'{cohort}','[]'::jsonb) where id=$1`, [request.requestId]);
    })).rejects.toMatchObject({ code: "23514" });
    await expect(db.transaction(async (tx) => {
      await tx.query("update project_parameter_value_change_targets set target_value='{}'::jsonb where request_id=$1", [request.requestId]);
    })).rejects.toMatchObject({ code: "55000" });
    await expect(createCandidate(runtime, storage, editor, { projectId: PROJECT, fileId, fileName: "board.dts", bytes: Buffer.from(base + "\n"),
      intent: "source_revision", expectedCurrentVersionId: versionId, expectedConfigRevisionId: revisionId, clientMutationId: "blocked-second" })
      .then((next) => previewSourceRevisionCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: next.id }))
      .then((preview) => submitSourceRevisionCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: preview.candidateId,
        expectedCurrentVersionId: versionId, expectedProofToken: preview.proofToken, reason: "overlap", assignedToUserId: REVIEWER, clientMutationId: "overlap-submit" },
      { invocation: createUserInvocation(editor), requestId: "overlap", refusalSink: createTrustedRefusalAuditSink(db) })))
      .rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source-review-pending" } });
    expect((await db.query("select status from project_parameter_file_candidates where id=$1", [staged.id])).rows[0]).toMatchObject({ status: "ready" });
    await approve(request.requestId);
  });

  it("removes a whole bound node using before-occurrence absence proof and keeps its history", async () => {
    const beforeHistoryCount = (await readSourceRevisionBindingState(db, { organizationId: ORG, projectId: PROJECT, bindingId })).historyCount;
    const text = base.replace(' charger: charger { compatible = "acme,power"; iin_max = <36>; };\n', "");
    const { request, preview } = await submit(text, "remove-nodes");
    expect(preview.impact.nodeRemovals).toBeGreaterThan(0);
    await approve(request.requestId);
    expect(await listCatalogBindingRowsForProject(db, editor, { projectId: PROJECT })).toHaveLength(0);
    const deleted = await readSourceRevisionBindingState(db, { organizationId: ORG, projectId: PROJECT, bindingId });
    expect(deleted).toMatchObject({ valueState: "deleted", locator: { kind: "dts-source-absence" } });
    expect(deleted.historyCount).toBe(beforeHistoryCount + 1);
    const exported = await exportCanonicalBindingSource(runtime, storage, editor, { projectId: PROJECT, bindingId, projectValueId: deleted.currentValueId });
    expect(exported).not.toBeNull();
    expect(canonicalSourceManifestSchema.safeParse(exported!.manifest).success).toBe(true);
    expect(await verifyCanonicalSourceReimport(runtime, storage, editor, { projectId: PROJECT, bindingId, source: exported! })).toEqual(exported);

    const restored = await candidate(base, "restore-whole-node");
    expect(await previewSourceRevisionCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: restored.id }))
      .toMatchObject({ canSubmit: true, impact: { restoredParameters: 1 } });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(runtime)!);
    const snapshots = await loadSourceRevisionCatalogSnapshots(runtime, PROJECT, ORG, catalog);
    const inspected = await runtime.transaction((tx) => inspectSourceRevision(tx, storage, reviewer,
      { projectId: PROJECT, candidateId: restored.id }, catalog, { lock: true, snapshots }));
    expect(inspected.proof.restorations?.map((row) => row.bindingId)).toContain(bindingId);
    const fresh = await candidate(base.replace("charger: charger", "new_charger: new_charger"), "new-node-after-deletion");
    expect(await previewSourceRevisionCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: fresh.id }))
      .toMatchObject({ canSubmit: true, impact: { parameterChanges: 1, nodeAdditions: 1 } });
    expect((await readSourceRevisionBindingState(db, { organizationId: ORG, projectId: PROJECT, bindingId })).currentValueId)
      .toBe(deleted.currentValueId);
  });

  it("restores a deleted property with the original binding identity and history", async () => {
    const withNode = base.replace("charger: charger", "resurrection: fresh");
    const first = await submit(withNode, "fresh-property");
    await approve(first.request.requestId);
    const original = (await listCatalogBindingRowsForProject(db, editor, { projectId: PROJECT }))[0]!;
    const absent = withNode.replace("iin_max = <36>;", "");
    const deletion = await submit(absent, "delete-property");
    await approve(deletion.request.requestId);
    const deleted = await readSourceRevisionBindingState(db, { organizationId: ORG, projectId: PROJECT, bindingId: original.id });
    const restored = await submit(withNode, "restore-property");
    expect(restored.preview.impact.restoredParameters).toBe(1);
    await approve(restored.request.requestId);
    expect((await listCatalogBindingRowsForProject(db, editor, { projectId: PROJECT }))[0]).toMatchObject({ id: original.id, rawValue: "<36>" });
    expect((await readSourceRevisionBindingState(db, { organizationId: ORG, projectId: PROJECT, bindingId: original.id })).historyCount).toBe(deleted.historyCount + 1);
    await approve((await submit(absent, "delete-restored-property")).request.requestId);
  });

  it("applies a source-only revision after deletion without changing the terminal history", async () => {
    const stored = (await db.query<{ storage_key: string }>("select storage_key from project_parameter_file_versions where id=$1", [versionId])).rows[0]!;
    const source = (await storage.get(stored.storage_key)).toString("utf8");
    const before = (await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).bindings;
    const { request, preview } = await submit(source + "/* source-only after terminal deletion */\n", "after-delete-comment");
    expect(preview.impact.parameterChanges).toBe(0);
    await approve(request.requestId);
    expect((await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).bindings).toEqual(before);
  });

  it("retains source on stale base, invalid syntax and cross-tenant requests", async () => {
    await expect(createCandidate(db, storage, editor, { projectId: PROJECT, fileId, fileName: "board.dts", bytes: Buffer.from(base),
      intent: "source_revision", expectedCurrentVersionId: "stale", expectedConfigRevisionId: revisionId, clientMutationId: "stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    const invalid = await candidate('/dts-v1/; / { broken = <;', "invalid-syntax");
    await expect(previewSourceRevisionCandidate(db, storage, editor, { projectId: PROJECT, candidateId: invalid.id })).rejects.toMatchObject({ code: expect.stringMatching(/VALIDATION_FAILED|CONFLICT/) });
    const foreign = makeTestAuthContext({ organizationId: "foreign", userId: "foreign", permissions: ["parameter:view", "admin:access"] });
    await expect(previewSourceRevisionCandidate(db, storage, foreign, { projectId: PROJECT, candidateId: invalid.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("exact source anchor restoration (PostgreSQL with injected validation)", { timeout: 120_000 }, () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  beforeAll(async () => { f = await createSourceAdminFixture("anchor-restore", createUserInvocation); }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("reactivates the original binding, rolls back an audit failure and replays without another history event", async () => {
    const scope = { organizationId: f.organizationId, projectId: f.projectId };
    const original = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    const binding = await readOwnedCurrentBinding(f.api, { ...scope, bindingId: original.id });
    if (binding.status !== "current") throw new Error("Missing current fixture binding");
    await (await f.stage(sourceAdminText.replace("iin_max = <36>;", ""), "delete-anchor")).apply();
    const deleted = await readSourceRevisionBindingState(f.db, { ...scope, bindingId: original.id });
    expect(deleted.valueState).toBe("deleted");
    const restore = await f.stage(sourceAdminText.replace("<36>", "<40>"), "restore-anchor");
    expect(restore.preview.impact).toMatchObject({ restoredParameters: 1, parameterChanges: 1 });
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toHaveLength(0);
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(f.api)!);
    if (!snapshot) throw new Error("Missing fixture snapshot");
    const refused = await f.api.transaction((tx) => appendProjectValue(asValueClient(tx), { snapshot, binding: { ...binding.binding, currentValueId: ProjectValueId(deleted.currentValueId), catalogRelease: snapshot.release },
      definitionRevisionId: binding.binding.effectiveRevisionId, expectedTip: ProjectValueId(deleted.currentValueId),
      source: { sourceRef: "unreviewed-restore", configRevisionId: restore.preview.configRevisionId }, payload: { kind: "number", value: 40 } }));
    expect(refused.ok).toBe(false);
    const before = await captureConfigurationSourceState(f.db, scope);
    await f.db.query(`create function public.refuse_anchor_audit() returns trigger language plpgsql as $$begin
      if new.metadata->>'restoredParameters'='1' then raise exception 'restoration audit failure'; end if; return new; end$$;
      create trigger refuse_anchor_audit before insert on public.audit_events for each row execute function public.refuse_anchor_audit()`);
    try { await expect(restore.apply()).rejects.toThrow("restoration audit failure"); }
    finally { await f.db.query("drop trigger refuse_anchor_audit on public.audit_events; drop function public.refuse_anchor_audit()"); }
    expect(await captureConfigurationSourceState(f.db, scope)).toEqual(before);
    const committed = await restore.apply();
    expect(await restore.apply()).toEqual(committed);
    const after = await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: original.id, rawValue: "<40>" });
    expect(await readOwnedCurrentBinding(f.api, { ...scope, bindingId: original.id })).toMatchObject({
      status: "current", binding: { sourceOccurrenceId: binding.binding.sourceOccurrenceId }
    });
    const restored = await readSourceRevisionBindingState(f.db, { ...scope, bindingId: original.id });
    expect(restored.historyCount).toBe(deleted.historyCount + 1);
    expect(restored).toMatchObject({ valueState: "present", locator: { kind: "dts-property" } });
    expect((await f.db.query<{ allowed: boolean }>("select parameter_catalog.source_anchor_restoration_matches($1,$2,$3,$4) as allowed",
      [committed.requestId, original.id, "forged-tip", restore.preview.configRevisionId])).rows[0]?.allowed).toBe(false);
  });

  it("restores a removed whole node using its historical logical identity", async () => {
    const original = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    await (await f.stage('/dts-v1/; / { compatible = "test,board"; model = "source administration"; };', "delete-whole-anchor")).apply();
    const restore = await f.stage(sourceAdminText, "restore-whole-anchor");
    expect(restore.preview.impact.restoredParameters).toBe(1);
    await restore.apply();
    const after = await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId });
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(original.id);
  });

  it("restores independently deleted nodes and their parents from every anchor's history", async () => {
    const original = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    const empty = '/dts-v1/; / { compatible = "test,board"; model = "source administration"; };';
    const second = 'bus { secondary: secondary { compatible = "acme,power"; iin_max = <44>; }; };';
    await (await f.stage(empty, "delete-first-era")).apply();
    await (await f.stage(empty.replace(/};$/, `${second} };`), "create-second-era")).apply();
    const independentlyCreated = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    await (await f.stage(empty, "delete-second-era")).apply();
    const restoration = await f.stage(sourceAdminText.replace(/};$/, `${second} };`), "restore-both-eras");
    expect(restoration.preview.impact).toMatchObject({ restoredParameters: 2, parameterChanges: 2 });
    await restoration.apply();
    expect((await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).map((row) => row.id).sort())
      .toEqual([original.id, independentlyCreated.id].sort());
  });

  it("commits an unapplied restoration for separate review, then restores atomically on approval", async () => {
    const original = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).find((row) => row.rawValue === "<36>")!;
    const without = sourceAdminText.replace("iin_max = <36>;", "");
    await (await f.stage(without, "review-delete")).apply();
    const restore = await f.stage(sourceAdminText, "review-restore");
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(f.api)!);
    const catalogSnapshots = await loadSourceRevisionCatalogSnapshots(f.api, f.projectId, f.organizationId, snapshot);
    await expect(f.api.transaction(async (tx) => {
      const { proof } = await inspectSourceRevision(tx, f.storage, f.auth, restore.input, snapshot,
        { toolchain: sourceAdminToolchain, snapshots: catalogSnapshots });
      await freezeSourceRevisionRequest(tx, f.auth, proof, { ...restore.input, assignedToUserId: null,
        clientMutationId: "unfinished-direct-restoration" }, sourceRevisionDigest("unfinished-direct-restoration"), "administrator_direct");
      await tx.query("set constraints project_parameter_administrator_source_transitions_ck immediate");
    })).rejects.toMatchObject({ code: "23514" });
    const reviewerId = "anchor-restoration-reviewer";
    await f.db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Restoration reviewer','Reviewer',true)", [reviewerId, f.organizationId]);
    await f.db.query("insert into user_role_bindings(id,user_id,organization_id,role_id,project_id) values ('anchor-review-admin',$1,$2,'admin',null),('anchor-review-software',$1,$2,'software-committer',$3)",
      [reviewerId, f.organizationId, f.projectId]);
    const reviewAuth = makeTestAuthContext({ organizationId: f.organizationId, userId: reviewerId,
      roles: [{ roleId: "admin", projectId: null }, { roleId: "software-committer", projectId: f.projectId }] });
    const before = await readSourceRevisionBindingState(f.db, { organizationId: f.organizationId, projectId: f.projectId, bindingId: original.id });
    const submitted = await submitSourceRevisionCandidate(f.api, f.storage, f.auth,
      { ...restore.input, assignedToUserId: reviewerId }, f.security, { toolchain: sourceAdminToolchain });
    expect(submitted.status).toBe("pending");
    expect(await readSourceRevisionBindingState(f.db, { organizationId: f.organizationId, projectId: f.projectId, bindingId: original.id })).toEqual(before);
    await f.api.transaction((tx) => commitSourceRevision(tx, f.storage, reviewAuth, snapshot, {
      projectId: f.projectId, requestId: submitted.requestId, invocation: createUserInvocation(reviewAuth), traceId: "anchor-restore-review",
      refusalSink: f.security.refusalSink, catalogSnapshots, toolchain: sourceAdminToolchain
    }));
    expect((await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]?.id).toBe(original.id);
    expect(await readSourceRevisionBindingState(f.db, { organizationId: f.organizationId, projectId: f.projectId, bindingId: original.id }))
      .toMatchObject({ valueState: "present", historyCount: before.historyCount + 1 });
  });
});
