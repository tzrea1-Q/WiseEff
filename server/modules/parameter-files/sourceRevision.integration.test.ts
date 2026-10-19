import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { validCatalogReleaseBundle } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { CURRENT_POINTER_LOCK_KEY } from "../catalog-kernel/install/lockProtocol";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { createLocalObjectStore } from "../logs/objectStore";
import { asValueClient, exportCanonicalBindingSource, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction, verifyCanonicalSourceReimport } from "../parameter-bindings/catalogProjectValueSync";
import { canonicalSourceManifestSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import { activateCandidate, createCandidate, recomputeCandidateImpact } from "./candidateService";
import { inspectSourceRevision, isSourceRevisionReviewer, loadSourceRevisionCatalogSnapshots, previewSourceRevisionCandidate, submitSourceRevisionCandidate } from "./sourceRevisionService";
import { previewCanonicalCandidate } from "./canonicalFileWorkflow";
import { commitSourceRevision } from "./sourceRevisionCommit";

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
    const bundle = validCatalogReleaseBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!current || !compiled.ok) throw new Error("Catalog fixture unavailable");
    expect(await installPublishedRelease(getRootPostgresPool(db)!, { mode: "advance", source: jsonCatalogReleaseSource(bundle),
      expectedCurrent: current.release, expectedTargetDigest: compiled.value.aggregateDigest })).toMatchObject({ ok: true });
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
        expect((await observer.query<{ locked: boolean }>("select pg_try_advisory_xact_lock($1::bigint) as locked", [CURRENT_POINTER_LOCK_KEY])).rows[0]!.locked).toBe(false);
        await expect(observer.query("lock table parameter_catalog.organization_subject_registrations in row exclusive mode nowait")).rejects.toMatchObject({ code: "55P03" });
        await observer.query("rollback");
      });
      await observer.query("begin");
      expect((await observer.query<{ locked: boolean }>("select pg_try_advisory_xact_lock($1::bigint) as locked", [CURRENT_POINTER_LOCK_KEY])).rows[0]!.locked).toBe(true);
      await observer.query("lock table parameter_catalog.organization_subject_registrations in row exclusive mode nowait");
      await observer.query("rollback");
    } finally { await observer.query("rollback").catch(() => undefined); observer.release(); }
    const { request } = await submit(base + "/* preserve historical Binding */\n", "historical-binding-apply");
    await approve(request.requestId);
    expect((await db.query<{ catalog_release_id: string }>("select catalog_release_id from parameter_catalog.project_parameter_bindings where id=$1", [bindingId])).rows[0]!.catalog_release_id).toBe(current.release.id);
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
    const readState = async () => (await db.query(`select
      (select current_version_id from project_parameter_files where id=$1) as version,
      (select count(*)::int from dts_config_revisions where config_set_id=$2) as revisions,
      (select jsonb_agg(jsonb_build_array(id,current_value_id) order by id) from parameter_catalog.project_parameter_bindings where project_id=$3) as tips,
      (select count(*)::int from parameter_catalog.project_value_source_pins where project_id=$3) as pins,
      (select count(*)::int from audit_events where target_id=$4 and action='value-change-applied') as applied_audits`,
      [fileId, configSetId, PROJECT, request.requestId])).rows;
    const initial = await readState();
    const input = { projectId: PROJECT, requestId: request.requestId, invocation: createUserInvocation(reviewer),
      traceId: "fault-injected-apply", refusalSink: createTrustedRefusalAuditSink(db), catalogSnapshots };
    await expect(runtime.transaction((tx) => commitSourceRevision(tx, { ...storage, getBounded: async () => { throw new Error("object-store-unavailable"); } },
      reviewer, catalog, input))).rejects.toThrow("object-store-unavailable");
    expect(await readState()).toEqual(initial);
    await expect(runtime.transaction((tx) => commitSourceRevision({ ...tx, query: async (sql, values) => {
      if (sql.includes("set status='approved'")) throw new Error("late-apply-failure");
      return tx.query(sql, values);
    } }, storage, reviewer, catalog, input))).rejects.toThrow("late-apply-failure");
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
    const beforeHistoryCount = (await db.query("select id from parameter_catalog.binding_history_events where binding_id=$1", [bindingId])).rows.length;
    const text = base.replace(' charger: charger { compatible = "acme,power"; iin_max = <36>; };\n', "");
    const { request, preview } = await submit(text, "remove-nodes");
    expect(preview.impact.nodeRemovals).toBeGreaterThan(0);
    await approve(request.requestId);
    expect(await listCatalogBindingRowsForProject(db, editor, { projectId: PROJECT })).toHaveLength(0);
    const deleted = (await db.query<{ locator: { kind: string }; value_state: string; project_value_id: string }>(
      `select pin.locator,value.value_state,pin.project_value_id from parameter_catalog.project_parameter_bindings binding
       join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
       join parameter_catalog.project_value_source_pins pin on pin.project_value_id=value.id where binding.id=$1`, [bindingId])).rows[0]!;
    expect(deleted).toMatchObject({ value_state: "deleted", locator: { kind: "dts-source-absence" } });
    expect((await db.query("select id from parameter_catalog.binding_history_events where binding_id=$1", [bindingId])).rows.length).toBe(beforeHistoryCount + 1);
    const exported = await exportCanonicalBindingSource(runtime, storage, editor, { projectId: PROJECT, bindingId, projectValueId: deleted.project_value_id });
    expect(exported).not.toBeNull();
    expect(canonicalSourceManifestSchema.safeParse(exported!.manifest).success).toBe(true);
    expect(await verifyCanonicalSourceReimport(runtime, storage, editor, { projectId: PROJECT, bindingId, source: exported! })).toEqual(exported);

    const restored = await candidate(base, "restore-whole-node");
    const restorationConflict = { code: "CONFLICT", details: {
      reason: "source-occurrence-restoration-requires-mapping", nodePath: "charger", propertyName: "iin_max"
    } };
    await expect(previewSourceRevisionCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: restored.id }))
      .rejects.toMatchObject(restorationConflict);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(runtime)!);
    await expect(runtime.transaction((tx) => inspectSourceRevision(tx, storage, reviewer,
      { projectId: PROJECT, candidateId: restored.id }, catalog, { lock: true }))).rejects.toMatchObject(restorationConflict);
    const fresh = await candidate(base.replace("charger: charger", "new_charger: new_charger"), "new-node-after-deletion");
    expect(await previewSourceRevisionCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: fresh.id }))
      .toMatchObject({ canSubmit: true, impact: { parameterChanges: 1, nodeAdditions: 1 } });
    expect((await db.query("select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [bindingId])).rows[0])
      .toEqual({ current_value_id: deleted.project_value_id });
  });

  it("rejects terminal property restoration at preview instead of creating an unapplicable request", async () => {
    const withNode = base.replace("charger: charger", "resurrection: fresh");
    const first = await submit(withNode, "fresh-property");
    await approve(first.request.requestId);
    const absent = withNode.replace("iin_max = <36>;", "");
    const deletion = await submit(absent, "delete-property");
    await approve(deletion.request.requestId);
    const restored = await candidate(withNode, "restore-property");
    await expect(previewSourceRevisionCandidate(runtime, storage, editor, { projectId: PROJECT, candidateId: restored.id })).rejects.toMatchObject({
      code: "CONFLICT", details: { reason: "source-occurrence-restoration-requires-mapping" }
    });
  });

  it("applies a source-only revision after deletion without changing the terminal history", async () => {
    const stored = (await db.query<{ storage_key: string }>("select storage_key from project_parameter_file_versions where id=$1", [versionId])).rows[0]!;
    const source = (await storage.get(stored.storage_key)).toString("utf8");
    const before = (await db.query("select id,current_value_id from parameter_catalog.project_parameter_bindings where project_id=$1 order by id", [PROJECT])).rows;
    const { request, preview } = await submit(source + "/* source-only after terminal deletion */\n", "after-delete-comment");
    expect(preview.impact.parameterChanges).toBe(0);
    await approve(request.requestId);
    expect((await db.query("select id,current_value_id from parameter_catalog.project_parameter_bindings where project_id=$1 order by id", [PROJECT])).rows).toEqual(before);
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
