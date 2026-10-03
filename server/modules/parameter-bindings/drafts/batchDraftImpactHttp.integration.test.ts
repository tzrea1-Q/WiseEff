import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { installConfigurationSourceFixture, captureConfigurationSourceState } from "../../../testing/parameterCatalog/configurationSource";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createRouter } from "../../../shared/http/router";
import { createHttpServer } from "../../../shared/http/server";
import { requestJson } from "../../../test/testClient";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { createCandidate } from "../../parameter-files/candidateService";
import { registerParameterFileRoutes } from "../../parameter-files/routes";
import { freezeCanonicalCandidateBatchSnapshotInTransaction, previewCanonicalCandidate } from "../../parameter-files/canonicalFileWorkflow";
import { registerCanonicalJsonSource } from "../../parameter-files/canonicalJsonSource";
import { loadPublishedCatalog } from "../catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../binding/migrationAdapter";
import { registerCatalogProjectValueConsumerRoutes } from "../catalogProjectValueRoutes";
import { createCanonicalValueDraft, listCanonicalValueDraftsForReviewer, removeCanonicalValueDraft } from "./service";
import { captureCanonicalBatchDraftImpactInTransaction } from "./batchChangeService";
import { catalogBatchValueChangeRequestResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";

const ORG = "org-906-c-impact-json";
const PROJECT = "project-906-c-impact-json";
const ADMIN = "user-906-c-impact-admin";
const REVIEWER = "user-906-c-impact-reviewer";
const AUTHOR = "user-906-c-impact-author";
const SECOND_AUTHOR = "user-906-c-impact-second-author";
const SOURCE = '{"first":{"limit":10},"second":{"limit":20},"third":{"limit":30}}\n';
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const author = makeTestAuthContext({ userId: AUTHOR, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: PROJECT }] });
const secondAuthor = makeTestAuthContext({ userId: SECOND_AUTHOR, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: PROJECT }] });

async function objectBytes(directory: string) {
  const names = (await readdir(directory, { recursive: true })).sort();
  return Promise.all(names.map(async (name) => {
    const path = join(directory, name);
    return [name, (await stat(path)).isFile() ? (await readFile(path)).toString("base64") : null];
  }));
}

describe("#906 C whole-cohort JSON draft impact over HTTP", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let storageDirectory: string;
  let fileId: string;
  let bindings: string[];

  beforeEach(async () => {
    lane = await createEphemeralTestDatabase("c906-json-draft-impact");
    db = createPostgresDatabase(lane.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-c906-json-impact-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'JSON impact')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$2,'author','User',true),($5,$2,'second','User',true)",
      [ADMIN, ORG, REVIEWER, AUTHOR, SECOND_AUTHOR]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'JSON impact','C906I','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c906-impact-admin',$1,$2,null,'admin'),('c906-impact-reviewer',$3,$2,$4,'software-committer'),('c906-impact-author',$5,$2,$4,'software-user'),('c906-impact-second',$6,$2,$4,'software-user')",
      [ADMIN, ORG, REVIEWER, PROJECT, AUTHOR, SECOND_AUTHOR]);
    await installConfigurationSourceFixture(db, admin, { subjectId: "csub_906_impact", schemaId: "wiseeff.906.impact" });
    const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "JSON impact" });
    const uploaded = await uploadProjectParameterFile(db, storage, admin, {
      projectId: PROJECT, fileName: "settings.json", bytes: Buffer.from(SOURCE)
    });
    fileId = uploaded.file.id;
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId, role: "base", sortOrder: 0 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    bindings = [];
    for (const [ordinal, key] of ["first", "second", "third"].entries()) {
      const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
        projectId: PROJECT, configSetId: set.id, fileId, fileVersionId: uploaded.version.id,
        configurationSchemaId: "wiseeff.906.impact", rootPointer: `/${key}`,
        mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: `/${key}/limit` }],
        invocation: createUserInvocation(admin), requestId: `c906-impact-register-${ordinal}`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
      bindings.push(registered.bindings[0]!.id);
    }
    expect(await Promise.all(bindings.map((id) => loadLegacyBindingIdentity(getRootPostgresPool(db)!, id))))
      .toEqual([null, null, null]);
  }, 120_000);

  afterEach(async () => {
    await db?.close();
    await lane?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  function route(auth = admin) {
    const router = createRouter();
    registerParameterFileRoutes(router, {
      db, objectStore: storage, getCurrentAuthContext: () => auth
    });
    registerCatalogProjectValueConsumerRoutes(router, {
      db, objectStore: storage, getCurrentAuthContext: () => auth
    });
    return createHttpServer(router);
  }

  async function expectedConflicts(candidateId: string, bindingId: string,
    choice: "file" | "draft", selectedDraftId?: string) {
    const conflicts = await requestJson<{ items: Array<{ selectedBindingId: string; selectedDraftId: string;
      choices: { file: { decisionProofDigest: string }; draft: { decisionProofDigest: string } } }> }>(
      route(), `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-conflicts`);
    expect(conflicts.status, JSON.stringify(conflicts.body)).toBe(200);
    return conflicts.body.items.filter((item) => item.selectedBindingId === bindingId).map((item) => ({
      draftId: item.selectedDraftId,
      decisionProofDigest: item.choices[choice === "draft" && item.selectedDraftId === selectedDraftId
        ? "draft" : "file"].decisionProofDigest
    }));
  }

  it("rejects a batch choice when the selected draft changed after conflict preview", async () => {
    const workflow = await requestJson<{ item: { proofToken: string } }>(route(),
      `/api/v1/projects/${PROJECT}/parameter-files/${fileId}/source-workflow`);
    const version = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!.current_version_id;
    const prepared = await requestJson<{ item: { candidateId: string; proofToken: string;
      targets: Array<{ bindingId: string; targetText: string }> } }>(route(),
      `/api/v1/projects/${PROJECT}/parameter-files/${fileId}/source-manual-sync/prepare`, {
        method: "POST", headers: { "X-Request-Id": "c906-preview-change-prepare" },
        body: JSON.stringify({
          contentBase64: Buffer.from('{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n').toString("base64"),
          expectedCurrentVersionId: version, expectedWorkflowProofToken: workflow.body.item.proofToken
        })
      });
    expect(prepared.status).toBe(201);
    const selectedTarget = prepared.body.item.targets.find((target) => target.targetText === "50")!;
    const selected = await draft(selectedTarget.bindingId);
    const conflicts = await requestJson<{ items: Array<{ selectedDraftId: string;
      choices: { file: { decisionProofDigest: string };
        draft: { targetText: string; selectedDraftProof: string; decisionProofDigest: string } } }> }>(
      route(), `/api/v1/projects/${PROJECT}/parameter-file-candidates/${prepared.body.item.candidateId}/source-conflicts`);
    expect(conflicts.status, JSON.stringify(conflicts.body)).toBe(200);
    const previewed = conflicts.body.items.find((item) => item.selectedDraftId === selected.id)!;
    expect(previewed.choices.draft.targetText).toBe("88");
    const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const submittedWith = (choice: "draft" | "file", proofs?: Array<{ draftId: string;
      decisionProofDigest: string }>) => requestJson(route(), path, { method: "POST", body: JSON.stringify({
      candidateId: prepared.body.item.candidateId, expectedProofToken: prepared.body.item.proofToken,
      reason: "Approve previewed choice", assignedToUserId: REVIEWER,
      targetDecisions: prepared.body.item.targets.map((target) => target.bindingId === selectedTarget.bindingId
        ? { bindingId: target.bindingId, choice,
          ...(choice === "draft" ? { draftId: selected.id } : {}),
          ...(proofs === undefined ? {} : { expectedConflictProofs: proofs }) }
        : { bindingId: target.bindingId, choice: "file" })
    }) });
    const missingProof = await submittedWith("draft");
    expect(missingProof).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-conflict-proof-stale" } } } });
    const baseRevisionId = (await db.query<{ config_revision_id: string }>(`
      select value.config_revision_id from parameter_catalog.project_parameter_bindings binding
        join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
       where binding.id=$1`, [selectedTarget.bindingId])).rows[0]!.config_revision_id;
    const changed = await requestJson<{ item: { draftId: string } }>(route(author),
      `/api/v2/projects/${PROJECT}/parameter-bindings/${selectedTarget.bindingId}/drafts`, {
        method: "POST", body: JSON.stringify({ baseRevisionId,
          sourceTarget: { format: "json", sourceText: "89" }, reason: "Author revised the choice" })
      });
    expect(changed.status, JSON.stringify(changed.body)).toBe(201);
    expect(changed.body.item.draftId).toBe(selected.id);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectsBefore = await objectBytes(storageDirectory);
    for (const [choice, digest] of [["draft", previewed.choices.draft.decisionProofDigest],
      ["file", conflicts.body.items.find((item) => item.selectedDraftId === selected.id)!.choices.file.decisionProofDigest]
    ] as const) {
      const response = await submittedWith(choice, [{ draftId: selected.id, decisionProofDigest: digest }]);
      expect(response).toMatchObject({ status: 409, body: { error: {
        details: { reason: "canonical-batch-conflict-proof-stale" } } } });
    }
    expect((await db.query<{ count: number }>(`select count(*)::int as count
      from project_parameter_value_change_requests where organization_id=$1 and project_id=$2`,
    [ORG, PROJECT])).rows[0]!.count).toBe(0);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objectBytes(storageDirectory)).toEqual(objectsBefore);
  }, 120_000);

  it("submits one mixed JSON request through prepare and batch HTTP", async () => {
    const workflow = await requestJson<{ item: { proofToken: string } }>(route(),
      `/api/v1/projects/${PROJECT}/parameter-files/${fileId}/source-workflow`);
    expect(workflow.status).toBe(200);
    const version = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!.current_version_id;
    const prepared = await requestJson<{ item: { candidateId: string; proofToken: string;
      targets: Array<{ bindingId: string; targetText: string }> } }>(route(),
      `/api/v1/projects/${PROJECT}/parameter-files/${fileId}/source-manual-sync/prepare`, {
        method: "POST", headers: { "X-Request-Id": "c906-mixed-json-prepare" },
        body: JSON.stringify({
          contentBase64: Buffer.from('{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n').toString("base64"),
          expectedCurrentVersionId: version, expectedWorkflowProofToken: workflow.body.item.proofToken
        })
      });
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
    const first = prepared.body.item.targets.find((target) => target.targetText === "50")!;
    const selected = await draft(first.bindingId);
    const second = prepared.body.item.targets.find((target) => target.targetText === "60")!;
    const unselected = await draft(second.bindingId, secondAuthor, 77);
    const sibling = bindings.find((id) => !prepared.body.item.targets.some((target) => target.bindingId === id))!;
    const siblingDraft = await draft(sibling, secondAuthor, 99);
    const submitBody = {
      candidateId: prepared.body.item.candidateId, expectedProofToken: prepared.body.item.proofToken,
      reason: "One mixed decision", assignedToUserId: REVIEWER,
      targetDecisions: await Promise.all(prepared.body.item.targets.map(async (target) => target.bindingId === first.bindingId
        ? { bindingId: target.bindingId, choice: "draft", draftId: selected.id,
          expectedConflictProofs: await expectedConflicts(prepared.body.item.candidateId,
            target.bindingId, "draft", selected.id) }
        : { bindingId: target.bindingId, choice: "file",
          expectedConflictProofs: await expectedConflicts(prepared.body.item.candidateId,
            target.bindingId, "file") }))
    };
    const submitted = await requestJson<{ item: { id: string; status: string; batchProofDigest: string;
      draftImpactDigest: string; decisionProofDigest: string; candidateId: string;
      targets: Array<{ bindingId: string; decision: string; draftId: string | null }> } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", headers: { "X-Request-Id": "c906-mixed-json-submit" },
        body: JSON.stringify(submitBody)
      });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    catalogBatchValueChangeRequestResponseSchema.parse(submitted.body);
    const request = submitted.body.item;
    expect(request.targets.map((target) => [target.bindingId, target.decision, target.draftId]))
      .toEqual(prepared.body.item.targets.map((target) => [target.bindingId,
        target.bindingId === first.bindingId ? "draft" : "file",
        target.bindingId === first.bindingId ? selected.id : null]));
    expect(request.candidateId).not.toBe(prepared.body.item.candidateId);
    for (const candidateId of [prepared.body.item.candidateId, request.candidateId]) {
      const preview = await requestJson<{ item: { request?: { id: string; status: string } } }>(route(),
        `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-preview`);
      expect(preview.status).toBe(200);
      expect(preview.body.item.request).toEqual({ id: request.id, status: "pending", kind: "batch" });
      const conflicts = await requestJson<{ request?: { id: string; status: string }; items: unknown[];
        ineligible: unknown[] }>(route(),
        `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-conflicts`);
      expect(conflicts.status).toBe(200);
      expect(conflicts.body).toMatchObject({ request: { id: request.id, status: "pending", kind: "batch" },
        items: [], ineligible: [] });
    }
    const beforeReplay = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectsBeforeReplay = await objectBytes(storageDirectory);
    const replay = await requestJson<{ item: { id: string } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", headers: { "X-Request-Id": "c906-mixed-json-submit" },
        body: JSON.stringify(submitBody)
      });
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.item.id).toBe(request.id);
    const newTraceReplay = await requestJson<{ item: { id: string } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", headers: { "X-Request-Id": "c906-mixed-json-submit-new-trace" },
        body: JSON.stringify(submitBody)
      });
    expect(newTraceReplay.body.item.id).toBe(request.id);
    expect((await requestJson(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", headers: { "X-Request-Id": "c906-mixed-json-submit" },
        body: JSON.stringify({ ...submitBody, reason: "Different retry" })
      })).status).toBe(409);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(beforeReplay);
    expect(await objectBytes(storageDirectory)).toEqual(objectsBeforeReplay);
    const queue = await requestJson<{ items: Array<{ id: string }> }>(route(reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches?status=pending`);
    expect(queue.body.items.map((item) => item.id)).toContain(request.id);
    const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${request.id}`;
    const detail = await requestJson<{ item: { draftImpact: Array<{ bindingId: string;
      role: string; decision: string; selectedDraftId?: string;
      drafts: Array<{ draftId: string }> }> } }>(route(reviewer), `${path}/batch`);
    expect(detail.status).toBe(200);
    expect(detail.body.item.draftImpact).toHaveLength(3);
    expect(detail.body.item.draftImpact.find((entry) => entry.bindingId === first.bindingId))
      .toMatchObject({ role: "target", decision: "draft", selectedDraftId: selected.id });
    expect(detail.body.item.draftImpact.find((entry) => entry.role === "sibling"))
      .toMatchObject({ decision: "re-pin", drafts: [{ draftId: siblingDraft.id }] });
    expect(detail.body.item.draftImpact.some((entry) =>
      entry.drafts.some((entry) => entry.draftId === unselected.id))).toBe(true);
    const diff = await requestJson<{ item: { uploadAfter: string; after: string;
      targets: Array<{ decision: string; draftId: string | null }> } }>(route(reviewer), `${path}/source-diff`);
    expect(diff.status, JSON.stringify(diff.body)).toBe(200);
    expect(diff.body.item.uploadAfter).toContain('"limit":50');
    expect(diff.body.item.after).toContain('"limit":88');
    expect(diff.body.item.after).toContain('"limit":60');
    expect(diff.body.item.after).toContain('"limit":30');
    expect(diff.body.item.targets.map((target) => [target.decision, target.draftId]))
      .toEqual(request.targets.map((target) => [target.decision, target.draftId]));
    const approvalBody = { decision: "approve", batchProofDigest: request.batchProofDigest,
      draftImpactDigest: request.draftImpactDigest, decisionProofDigest: request.decisionProofDigest };
    const separatelyPending = await requestJson<{ item: { id: string } }>(route(author),
      `/api/v2/projects/${PROJECT}/parameter-value-drafts/${selected.id}/submit`, {
        method: "POST", body: JSON.stringify({ assignedToUserId: REVIEWER }) });
    expect(separatelyPending.status, JSON.stringify(separatelyPending.body)).toBe(201);
    const pendingBefore = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const pendingObjects = await objectBytes(storageDirectory);
    expect(await requestJson(route(reviewer), `${path}/review`, {
      method: "POST", body: JSON.stringify(approvalBody)
    })).toMatchObject({ status: 409, body: { error: { details: { reason: "selected-draft-pending" } } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(pendingBefore);
    expect(await objectBytes(storageDirectory)).toEqual(pendingObjects);
    expect((await requestJson(route(author),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${separatelyPending.body.item.id}/withdraw`,
      { method: "POST" })).status).toBe(200);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const approved = await requestJson(route(reviewer), `${path}/review`, {
      method: "POST", body: JSON.stringify(approvalBody)
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ item: { status: "approved" } });
    for (const candidateId of [prepared.body.item.candidateId, request.candidateId]) {
      const preview = await requestJson<{ item: { request?: { id: string; status: string } } }>(route(),
        `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-preview`);
      expect(preview.body.item.request).toEqual({ id: request.id, status: "approved", kind: "batch" });
      expect((await requestJson(route(),
        `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-conflicts`)).body)
        .toMatchObject({ request: preview.body.item.request, items: [] });
    }
    const after = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    expect(after.values).toHaveLength(before.values.length + 3);
    expect(after.pins).toHaveLength(before.pins.length + 3);
    expect(after.history).toHaveLength(before.history.length + 3);
    expect(after.versions).toHaveLength(before.versions.length + 1);
    expect(after.audits).toHaveLength(before.audits.length + 1);
    expect(after.drafts).toEqual(before.drafts);
    for (const [bindingId, draftId] of [[first.bindingId, selected.id],
      [second.bindingId, unselected.id], [sibling, siblingDraft.id]] as const) {
      expect(await listCanonicalValueDraftsForReviewer(db, reviewer, { projectId: PROJECT, bindingId }))
        .toEqual(expect.arrayContaining([expect.objectContaining({ draftId, stale: true })]));
      const pin = (await db.query<{ file_version_id: string }>(`
        select pin.file_version_id from parameter_catalog.project_parameter_bindings binding
          join parameter_catalog.project_value_source_pins pin
            on pin.binding_id=binding.id and pin.project_value_id=binding.current_value_id
         where binding.id=$1`, [bindingId])).rows[0];
      expect(pin?.file_version_id).toBe(after.files.find((file) => file.id === fileId)?.currentVersionId);
    }
    const values = (await db.query<{ value: unknown }>(`
      select value.value from parameter_catalog.project_parameter_bindings binding
        join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
       where binding.organization_id=$1 and binding.project_id=$2`, [ORG, PROJECT])).rows;
    expect(values.map((entry) => entry.value).sort((a, b) => Number(a) - Number(b)))
      .toEqual([30, 60, 88]);
    expect((await requestJson(route(reviewer), `${path}/review`, {
      method: "POST", body: JSON.stringify(approvalBody)
    })).body).toEqual(approved.body);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(after);
    const beforeStaleSubmit = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const beforeStaleObjects = await objectBytes(storageDirectory);
    const staleSubmission = await requestJson(route(secondAuthor),
      `/api/v2/projects/${PROJECT}/parameter-value-drafts/${siblingDraft.id}/submit`, {
        method: "POST", body: JSON.stringify({ assignedToUserId: REVIEWER }) });
    expect(staleSubmission).toMatchObject({ status: 409, body: { error: {
      details: { reason: "stale-base-value" } } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(beforeStaleSubmit);
    expect(await objectBytes(storageDirectory)).toEqual(beforeStaleObjects);
  }, 120_000);

  it("rejects omitted or wrong mixed decisions and a newly inserted sibling draft", async () => {
    const workflow = await requestJson<{ item: { proofToken: string } }>(route(),
      `/api/v1/projects/${PROJECT}/parameter-files/${fileId}/source-workflow`);
    expect(workflow.status).toBe(200);
    const version = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!.current_version_id;
    const prepared = await requestJson<{ item: { candidateId: string; proofToken: string;
      targets: Array<{ bindingId: string; targetText: string }> } }>(route(),
      `/api/v1/projects/${PROJECT}/parameter-files/${fileId}/source-manual-sync/prepare`, {
        method: "POST", headers: { "X-Request-Id": "c906-mixed-json-negative-prepare" },
        body: JSON.stringify({
          contentBase64: Buffer.from('{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n').toString("base64"),
          expectedCurrentVersionId: version, expectedWorkflowProofToken: workflow.body.item.proofToken
        })
      });
    expect(prepared.status).toBe(201);
    const first = prepared.body.item.targets.find((target) => target.targetText === "50")!;
    const selected = await draft(first.bindingId);
    const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const base = { candidateId: prepared.body.item.candidateId,
      expectedProofToken: prepared.body.item.proofToken,
      reason: "Mixed JSON negative", assignedToUserId: REVIEWER };
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectBefore = await objectBytes(storageDirectory);
    expect((await requestJson(route(), path, { method: "POST", body: JSON.stringify(base) })).status).toBe(409);
    expect((await requestJson(route(), path, { method: "POST", body: JSON.stringify({ ...base,
      targetDecisions: [{ bindingId: first.bindingId, choice: "draft", draftId: selected.id }]
    }) })).status).toBe(409);
    expect((await requestJson(route(), path, { method: "POST", body: JSON.stringify({ ...base,
      expectedProofToken: "wrong-proof", targetDecisions: prepared.body.item.targets.map((target) => ({
        bindingId: target.bindingId, choice: target.bindingId === first.bindingId ? "draft" : "file",
        ...(target.bindingId === first.bindingId ? { draftId: selected.id } : {})
      }))
    }) })).status).toBe(409);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objectBytes(storageDirectory)).toEqual(objectBefore);
    const targetDecisions = await Promise.all(prepared.body.item.targets.map(async (target) => ({
      bindingId: target.bindingId, choice: target.bindingId === first.bindingId ? "draft" : "file",
      ...(target.bindingId === first.bindingId ? { draftId: selected.id } : {}),
      expectedConflictProofs: await expectedConflicts(prepared.body.item.candidateId, target.bindingId,
        target.bindingId === first.bindingId ? "draft" : "file", selected.id)
    })));
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string; decisionProofDigest: string } }>(route(), path, {
        method: "POST", headers: { "X-Request-Id": "c906-mixed-json-negative-submit" },
        body: JSON.stringify({ ...base, targetDecisions })
      });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const sibling = bindings.find((id) => !prepared.body.item.targets.some((target) => target.bindingId === id))!;
    await draft(sibling, secondAuthor, 99);
    const drifted = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const driftObjects = await objectBytes(storageDirectory);
    const review = await requestJson(route(reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/review`, {
        method: "POST", body: JSON.stringify({ decision: "approve",
          batchProofDigest: submitted.body.item.batchProofDigest,
          draftImpactDigest: submitted.body.item.draftImpactDigest,
          decisionProofDigest: submitted.body.item.decisionProofDigest })
      });
    expect(review).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-draft-impact-stale" } } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(drifted);
    expect(await objectBytes(storageDirectory)).toEqual(driftObjects);
  }, 120_000);

  async function draft(bindingId: string, user = author, value = 88) {
    const base = (await db.query<{ current_value_id: string; config_revision_id: string }>(`
      select binding.current_value_id,value.config_revision_id
        from parameter_catalog.project_parameter_bindings binding
        join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
       where binding.id=$1`, [bindingId])).rows[0]!;
    return createCanonicalValueDraft(db, user, {
      projectId: PROJECT, bindingId, sourceTarget: { format: "json", sourceText: String(value) },
      reason: "Other author's competing draft", baseRevisionId: base.config_revision_id,
      baseCurrentValueId: base.current_value_id
    }, { objectStore: storage, invocation: createUserInvocation(user),
      requestId: `c906-impact-draft-${bindingId}-${user.user.id}-${value}`,
      refusalSink: createTrustedRefusalAuditSink(db) });
  }

  async function candidate() {
    const item = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId, fileName: "settings.json",
      bytes: Buffer.from('{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n')
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: item.id });
    expect(preview.bindings).toHaveLength(2);
    return { item, preview };
  }

  it.each(["single-before-batch", "single-after-batch"])(
    "blocks a pending sibling JSON request: %s", async (order) => {
      const workflow = await requestJson<{ item: { proofToken: string } }>(route(),
        `/api/v1/projects/${PROJECT}/parameter-files/${fileId}/source-workflow`);
      const version = (await db.query<{ current_version_id: string }>(
        "select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!.current_version_id;
      const prepared = await requestJson<{ item: { candidateId: string; proofToken: string;
        targets: Array<{ bindingId: string }> } }>(route(),
        `/api/v1/projects/${PROJECT}/parameter-files/${fileId}/source-manual-sync/prepare`, {
          method: "POST", headers: { "X-Request-Id": `c906-json-pending-${order}-prepare` },
          body: JSON.stringify({
            contentBase64: Buffer.from('{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n').toString("base64"),
            expectedCurrentVersionId: version, expectedWorkflowProofToken: workflow.body.item.proofToken
          })
        });
      expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
      const sibling = bindings.find((id) => !prepared.body.item.targets.some((target) => target.bindingId === id))!;
      const oldDraft = await draft(sibling, secondAuthor, 99);
      const submitSingle = () => requestJson<{ item: { id: string; status: string } }>(route(secondAuthor),
        `/api/v2/projects/${PROJECT}/parameter-value-drafts/${oldDraft.id}/submit`, {
          method: "POST", body: JSON.stringify({ assignedToUserId: REVIEWER }) });
      const singleBefore = order === "single-before-batch" ? await submitSingle() : null;
      if (singleBefore) expect(singleBefore.status, JSON.stringify(singleBefore.body)).toBe(201);
      const conflicts = await requestJson<{ items: unknown[]; ineligible: unknown[] }>(route(),
        `/api/v1/projects/${PROJECT}/parameter-file-candidates/${prepared.body.item.candidateId}/source-conflicts`);
      expect(conflicts).toMatchObject({ status: 200, body: { items: [], ineligible: [] } });
      const batchBody = { candidateId: prepared.body.item.candidateId,
        expectedProofToken: prepared.body.item.proofToken,
        reason: "Review two changed JSON values", assignedToUserId: REVIEWER };
      if (singleBefore) {
        const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
        const beforeObjects = await objectBytes(storageDirectory);
        const refused = await requestJson(route(),
          `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
            method: "POST", body: JSON.stringify(batchBody) });
        expect(refused).toMatchObject({ status: 409, body: { error: {
          details: { reason: "cohort-draft-pending-review", bindingId: sibling } } } });
        expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
        expect(await objectBytes(storageDirectory)).toEqual(beforeObjects);
        expect((await requestJson(route(secondAuthor),
          `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${singleBefore.body.item.id}/withdraw`,
          { method: "POST" })).status).toBe(200);
        const refreshed = await requestJson(route(),
          `/api/v1/projects/${PROJECT}/parameter-file-candidates/${prepared.body.item.candidateId}/source-conflicts`);
        expect(refreshed).toMatchObject({ status: 200, body: { items: [], ineligible: [] } });
      }
      const submitted = await requestJson<{ item: { id: string; status: string; batchProofDigest: string;
        draftImpactDigest: string } }>(route(),
        `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
          method: "POST", body: JSON.stringify(batchBody) });
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
      const batch = submitted.body.item;
      const detail = await requestJson<{ item: { draftImpact: Array<{ bindingId: string; role: string;
        drafts: Array<{ draftId: string; expectedEffect: string }> }> } }>(route(reviewer),
        `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${batch.id}/batch`);
      expect(detail.status).toBe(200);
      expect(detail.body.item.draftImpact).toHaveLength(3);
      expect(detail.body.item.draftImpact.find((entry) => entry.bindingId === sibling))
        .toMatchObject({ role: "sibling", drafts: [{ draftId: oldDraft.id,
          expectedEffect: "preserved-stale" }] });
      const single = singleBefore ?? await submitSingle();
      expect(single.status, JSON.stringify(single.body)).toBe(201);
      expect(JSON.stringify(detail.body.item.draftImpact)).not.toContain(single.body.item.id);
      if (!singleBefore) {
        const beforeReplay = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
        const replayObjects = await objectBytes(storageDirectory);
        const replay = await requestJson<{ item: { id: string } }>(route(),
          `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
            method: "POST", body: JSON.stringify(batchBody) });
        expect(replay.status, JSON.stringify(replay.body)).toBe(201);
        expect(replay.body.item.id).toBe(batch.id);
        expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(beforeReplay);
        expect(await objectBytes(storageDirectory)).toEqual(replayObjects);
        const blocked = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
        const blockedObjects = await objectBytes(storageDirectory);
        const refused = await requestJson(route(reviewer),
          `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${batch.id}/review`, {
            method: "POST", body: JSON.stringify({ decision: "approve",
              batchProofDigest: batch.batchProofDigest, draftImpactDigest: batch.draftImpactDigest }) });
        expect(refused).toMatchObject({ status: 409, body: { error: {
          details: { reason: "cohort-draft-pending-review", bindingId: sibling } } } });
        expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(blocked);
        expect(await objectBytes(storageDirectory)).toEqual(blockedObjects);
        expect((await requestJson(route(secondAuthor),
          `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${single.body.item.id}/withdraw`,
          { method: "POST" })).status).toBe(200);
      }
      const pending = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
      expect(pending.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: single.body.item.id, status: "withdrawn" }),
        expect.objectContaining({ id: batch.id, status: "pending" })]));
      const diff = await requestJson<{ item: { bindings: unknown[] } }>(route(reviewer),
        `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${batch.id}/source-diff`);
      expect(diff.status).toBe(200);
      expect(diff.body.item.bindings).toHaveLength(3);
      const approved = await requestJson(route(reviewer),
        `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${batch.id}/review`, {
          method: "POST", body: JSON.stringify({ decision: "approve",
            batchProofDigest: batch.batchProofDigest, draftImpactDigest: batch.draftImpactDigest }) });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      const after = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
      expect(after.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: single.body.item.id, status: "withdrawn" }),
        expect.objectContaining({ id: batch.id, status: "approved" })]));
      expect((await requestJson<{ items: Array<{ id: string }> }>(route(reviewer),
        `/api/v2/projects/${PROJECT}/parameter-value-change-requests?status=pending`))
        .body.items.map((item) => item.id)).not.toContain(single.body.item.id);
      expect(after.values).toHaveLength(pending.values.length + 3);
      expect(after.pins).toHaveLength(pending.pins.length + 3);
      expect(after.history).toHaveLength(pending.history.length + 3);
      expect(after.versions).toHaveLength(pending.versions.length + 1);
      expect(after.audits).toHaveLength(pending.audits.length + 1);
      expect(after.drafts).toEqual(pending.drafts);
      expect(await listCanonicalValueDraftsForReviewer(db, reviewer, { projectId: PROJECT, bindingId: sibling }))
        .toEqual([expect.objectContaining({ draftId: oldDraft.id, stale: true,
          pendingRequestId: null })]);
      const current = (await db.query<{ binding_id: string; value: unknown; file_version_id: string }>(`
        select binding.id as binding_id,value.value,pin.file_version_id
          from parameter_catalog.project_parameter_bindings binding
          join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
          join parameter_catalog.project_value_source_pins pin
            on pin.binding_id=binding.id and pin.project_value_id=value.id
         where binding.organization_id=$1 and binding.project_id=$2`, [ORG, PROJECT])).rows;
      expect(current.map((entry) => entry.value).sort((a, b) => Number(a) - Number(b)))
        .toEqual([30, 50, 60]);
      expect(current).toHaveLength(3);
      expect(current.every((entry) => entry.file_version_id === after.files.find((file) => file.id === fileId)?.currentVersionId))
        .toBe(true);
      const finalVersion = (await db.query<{ storage_key: string }>(`
        select storage_key from project_parameter_file_versions where id=$1`,
      [after.files.find((file) => file.id === fileId)?.currentVersionId])).rows[0]!;
      expect((await storage.get(finalVersion.storage_key)).toString())
        .toBe('{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n');
      const beforeOldReview = await objectBytes(storageDirectory);
      const oldReview = await requestJson(route(reviewer),
        `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${single.body.item.id}/review`, {
          method: "POST", body: JSON.stringify({ decision: "approve" }) });
      expect(oldReview).toMatchObject({ status: 409, body: { error: { code: "CONFLICT" } } });
      expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(after);
      expect(await objectBytes(storageDirectory)).toEqual(beforeOldReview);
    }, 120_000);

  it("reports unprepared and pending target drafts before a JSON batch can be reviewed", async () => {
    const { item, preview } = await candidate();
    const [first, second] = preview.bindings!;
    const siblingId = bindings.find((id) => !preview.bindings!.some((entry) => entry.bindingId === id))!;
    const unprepared = await draft(first!.bindingId);
    const pending = await draft(second!.bindingId, secondAuthor, 77);
    const sibling = await draft(siblingId, secondAuthor, 99);
    const beforeStatusChange = await requestJson<{ items: Array<{ selectedBindingId: string;
      selectedDraftId: string; choices: { file: { decisionProofDigest: string } } }> }>(route(),
      `/api/v1/projects/${PROJECT}/parameter-file-candidates/${item.id}/source-conflicts`);
    expect(beforeStatusChange.status).toBe(200);
    expect(beforeStatusChange.body.items).toHaveLength(2);
    const artifact = (await db.query<{ candidate_id: string; candidate_base_digest: string;
      candidate_proposed_digest: string; candidate_diff_digest: string;
      candidate_member_manifest: unknown; candidate_binding_manifest: unknown }>(`
      select candidate_id,candidate_base_digest,candidate_proposed_digest,candidate_diff_digest,
        candidate_member_manifest,candidate_binding_manifest from project_parameter_value_drafts where id=$1`,
    [unprepared.id])).rows[0]!;
    // A historical draft can have a valid current base but no prepared source artifact.
    await db.query(`update project_parameter_value_drafts set candidate_id=null,
      candidate_base_digest=null,candidate_proposed_digest=null,candidate_diff_digest=null,
      candidate_member_manifest=null,candidate_binding_manifest=null where id=$1`, [unprepared.id]);
    const requested = await requestJson<{ item: { id: string } }>(route(secondAuthor),
      `/api/v2/projects/${PROJECT}/parameter-value-drafts/${pending.id}/submit`, {
        method: "POST", body: JSON.stringify({ assignedToUserId: REVIEWER }) });
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
    const conflictPath = `/api/v1/projects/${PROJECT}/parameter-file-candidates/${item.id}/source-conflicts`;
    const discovered = await requestJson<{ items: Array<{ selectedDraftId: string;
      choices: { file: { decisionProofDigest: string } } }>;
      ineligible: Array<{ selectedDraftId: string; reason: string }> }>(route(), conflictPath);
    expect(discovered.status).toBe(200);
    expect(discovered.body.items).toEqual([]);
    expect(discovered.body.ineligible).toEqual(expect.arrayContaining([
      { selectedBindingId: first!.bindingId, selectedDraftId: unprepared.id,
        reason: "selected-draft-source-proof-missing" },
      { selectedBindingId: second!.bindingId, selectedDraftId: pending.id,
        reason: "selected-draft-pending" }
    ]));
    const impact = await db.transaction(async (tx) => {
      const proof = await freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
        projectId: PROJECT, candidateId: item.id, expectedProofToken: preview.proofToken
      });
      return captureCanonicalBatchDraftImpactInTransaction(tx, admin, PROJECT, proof,
        proof.targets.map((target) => ({ bindingId: target.bindingId, choice: "file" })));
    });
    expect(impact.draftImpact.flatMap((entry) => entry.drafts.map((entry) => entry.draftId)).sort())
      .toEqual([unprepared.id, pending.id, sibling.id].sort());
    expect(impact.draftImpact.find((entry) => entry.bindingId === siblingId))
      .toMatchObject({ role: "sibling", decision: "re-pin" });
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectBefore = await objectBytes(storageDirectory);
    const body = { candidateId: item.id, expectedProofToken: preview.proofToken,
      reason: "Review both source conflicts", assignedToUserId: REVIEWER,
      targetDecisions: preview.bindings!.map((target) => ({ bindingId: target.bindingId,
        choice: "file", expectedConflictProofs: [] })) };
    const submitPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const refused = await requestJson(route(), submitPath, { method: "POST", body: JSON.stringify(body) });
    expect(refused.status).toBe(409);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objectBytes(storageDirectory)).toEqual(objectBefore);

    await db.query(`update project_parameter_value_drafts set candidate_id=$2,
      candidate_base_digest=$3,candidate_proposed_digest=$4,candidate_diff_digest=$5,
      candidate_member_manifest=$6,candidate_binding_manifest=$7 where id=$1`,
    [unprepared.id, artifact.candidate_id, artifact.candidate_base_digest,
      artifact.candidate_proposed_digest, artifact.candidate_diff_digest,
      JSON.stringify(artifact.candidate_member_manifest), JSON.stringify(artifact.candidate_binding_manifest)]);
    const pendingOnly = await requestJson<typeof discovered.body>(route(), conflictPath);
    expect(pendingOnly.body.items.map((entry) => entry.selectedDraftId)).toEqual([unprepared.id]);
    expect(pendingOnly.body.ineligible).toEqual([{
      selectedBindingId: second!.bindingId, selectedDraftId: pending.id, reason: "selected-draft-pending"
    }]);
    const pendingBefore = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const pendingObjectsBefore = await objectBytes(storageDirectory);
    const oldProofs = preview.bindings!.map((target) => ({ bindingId: target.bindingId,
      choice: "file", expectedConflictProofs: beforeStatusChange.body.items
        .filter((entry) => entry.selectedBindingId === target.bindingId)
        .map((entry) => ({ draftId: entry.selectedDraftId,
          decisionProofDigest: entry.choices.file.decisionProofDigest })) }));
    const pendingRefusal = await requestJson(route(), submitPath, { method: "POST",
      body: JSON.stringify({ ...body, targetDecisions: oldProofs }) });
    expect(pendingRefusal).toMatchObject({ status: 409, body: { error: {
      details: { reason: "selected-draft-pending" } } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(pendingBefore);
    expect(await objectBytes(storageDirectory)).toEqual(pendingObjectsBefore);
    expect((await requestJson(route(secondAuthor),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${requested.body.item.id}/withdraw`,
      { method: "POST" })).status).toBe(200);
    const refreshed = await requestJson<typeof discovered.body>(route(), conflictPath);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.ineligible).toEqual([]);
    expect(refreshed.body.items.map((entry) => entry.selectedDraftId).sort())
      .toEqual([unprepared.id, pending.id].sort());
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string } }>(route(), submitPath, { method: "POST", body: JSON.stringify({
      ...body, targetDecisions: await Promise.all(preview.bindings!.map(async (target) => ({
        bindingId: target.bindingId, choice: "file",
        expectedConflictProofs: await expectedConflicts(item.id, target.bindingId, "file")
      })))
    }) });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const approved = await requestJson(route(reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/review`, {
        method: "POST", body: JSON.stringify({ decision: "approve",
          batchProofDigest: submitted.body.item.batchProofDigest,
          draftImpactDigest: submitted.body.item.draftImpactDigest }) });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const after = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    expect(after.drafts.map((entry) => entry.id).sort()).toEqual([unprepared.id, pending.id, sibling.id].sort());
    expect(after.values).toHaveLength(before.values.length + 3);
    expect(after.pins).toHaveLength(before.pins.length + 3);
    expect(after.history).toHaveLength(before.history.length + 3);
    expect(after.versions).toHaveLength(before.versions.length + 1);
    const next = await createCandidate(db, storage, admin, { projectId: PROJECT, fileId,
      fileName: "settings.json",
      bytes: Buffer.from('{"first":{"limit":55},"second":{"limit":65},"third":{"limit":30}}\n') });
    const stale = await requestJson<typeof discovered.body>(route(),
      `/api/v1/projects/${PROJECT}/parameter-file-candidates/${next.id}/source-conflicts`);
    expect(stale.status).toBe(200);
    expect(stale.body.items).toEqual([]);
    expect(stale.body.ineligible).toHaveLength(2);
    expect(stale.body.ineligible).toEqual(expect.arrayContaining([
      { selectedBindingId: first!.bindingId, selectedDraftId: unprepared.id, reason: "selected-draft-stale" },
      { selectedBindingId: second!.bindingId, selectedDraftId: pending.id, reason: "selected-draft-stale" }
    ]));
  }, 120_000);

  it("requires a preview proof for every competing draft on an explicit file target", async () => {
    const { item, preview } = await candidate();
    const target = preview.bindings![0]!.bindingId;
    const first = await draft(target);
    const second = await draft(target, secondAuthor, 89);
    const proofs = await expectedConflicts(item.id, target, "file");
    expect(proofs.map((entry) => entry.draftId).sort()).toEqual([first.id, second.id].sort());
    const body = { candidateId: item.id, expectedProofToken: preview.proofToken,
      reason: "Choose the file after reviewing both drafts", assignedToUserId: REVIEWER,
      targetDecisions: [{ bindingId: target, choice: "file", expectedConflictProofs: proofs.slice(0, 1) }] };
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectsBefore = await objectBytes(storageDirectory);
    const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const incomplete = await requestJson(route(), path, { method: "POST", body: JSON.stringify(body) });
    expect(incomplete).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-conflict-proof-stale" } } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objectBytes(storageDirectory)).toEqual(objectsBefore);
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string } }>(route(), path, { method: "POST", body: JSON.stringify({
        ...body, targetDecisions: [{ bindingId: target, choice: "file", expectedConflictProofs: proofs }]
      }) });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const approved = await requestJson(route(reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/review`, {
        method: "POST", body: JSON.stringify({ decision: "approve",
          batchProofDigest: submitted.body.item.batchProofDigest,
          draftImpactDigest: submitted.body.item.draftImpactDigest })
      });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await db.query<{ id: string }>(`select id from project_parameter_value_drafts
      where id=any($1::text[]) order by id`, [[first.id, second.id]])).rows).toHaveLength(2);
  }, 120_000);

  it("hides omission and incomplete draft decisions, then approves explicit file values with full impact", async () => {
    const { item, preview } = await candidate();
    const target = preview.bindings![0]!.bindingId;
    const sibling = bindings.find((id) => !preview.bindings!.some((entry) => entry.bindingId === id))!;
    const firstDraft = await draft(target);
    const siblingDraft = await draft(sibling);
    const captureFor = (choice: "file" | "draft") => db.transaction(async (tx) => {
      const proof = await freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
        projectId: PROJECT, candidateId: item.id, expectedProofToken: preview.proofToken
      });
      return captureCanonicalBatchDraftImpactInTransaction(tx, admin, PROJECT, proof,
        proof.targets.map((entry) => entry.bindingId === target
          ? { bindingId: entry.bindingId, choice, ...(choice === "draft" ? { draftId: firstDraft.id } : {}) }
          : { bindingId: entry.bindingId, choice: "file" as const }));
    });
    const draftChoice = await captureFor("draft");
    const fileChoice = await captureFor("file");
    expect(draftChoice.draftImpact.find((entry) => entry.bindingId === target))
      .toMatchObject({ role: "target", decision: "draft", selectedDraftId: firstDraft.id });
    expect(draftChoice.draftImpact.find((entry) => entry.bindingId === sibling))
      .toMatchObject({ role: "sibling", decision: "re-pin" });
    expect(draftChoice.draftImpact.filter((entry) => entry.role === "target").map((entry) => entry.decision))
      .toEqual(["draft", "file"]);
    expect(draftChoice.draftImpactDigest).not.toBe(fileChoice.draftImpactDigest);
    const body = { candidateId: item.id, expectedProofToken: preview.proofToken,
      reason: "One cohort review", assignedToUserId: REVIEWER };
    const submitPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const beforeRejected = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectsBeforeRejected = await objectBytes(storageDirectory);
    const omitted = await requestJson(route(), submitPath, { method: "POST", body: JSON.stringify(body) });
    expect(omitted).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-target-decision-required" } } } });
    const unsupported = await requestJson(route(), submitPath, { method: "POST", body: JSON.stringify({
      ...body, targetDecisions: [{ bindingId: target, choice: "draft", draftId: firstDraft.id }]
    }) });
    expect(unsupported).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-target-decision-required" } } } });
    expect((await db.query<{ count: number }>(`select count(*)::int as count
      from project_parameter_value_change_requests where candidate_id=$1`, [item.id])).rows[0]!.count).toBe(0);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(beforeRejected);
    expect(await objectBytes(storageDirectory)).toEqual(objectsBeforeRejected);
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string; uploadCandidateId: string | null;
      compositionProof: unknown; decisionProofDigest: string | null;
      targets: Array<{ bindingId: string; decision: string; targetValue: unknown }>;
      draftImpact: Array<{ bindingId: string; role: string;
        decision: string; drafts: Array<{ draftId: string; expectedEffect: string }> }> } }>(route(), submitPath,
      { method: "POST", body: JSON.stringify({ ...body,
        targetDecisions: [{ bindingId: target, choice: "file",
          expectedConflictProofs: await expectedConflicts(item.id, target, "file") }] }) });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    catalogBatchValueChangeRequestResponseSchema.parse(submitted.body);
    expect(submitted.body.item).toMatchObject({ uploadCandidateId: null,
      compositionProof: null, decisionProofDigest: null });
    expect(submitted.body.item.targets.map((entry) => entry.decision)).toEqual(["file", "file"]);
    expect(submitted.body.item.draftImpact).toHaveLength(3);
    expect(submitted.body.item.draftImpact.find((entry) => entry.bindingId === target)?.drafts)
      .toEqual([expect.objectContaining({ draftId: firstDraft.id, expectedEffect: "preserved-stale" })]);
    expect(submitted.body.item.draftImpact.find((entry) => entry.bindingId === sibling))
      .toMatchObject({ role: "sibling", decision: "re-pin",
        drafts: [{ draftId: siblingDraft.id, expectedEffect: "preserved-stale" }] });
    const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}`;
    expect((await requestJson(route(reviewer), `${path}/batch`)).status).toBe(200);
    expect((await requestJson(route(admin), `${path}/batch`)).status).toBe(200);
    expect((await requestJson(route(author), `${path}/batch`)).status).toBe(404);
    const diff = await requestJson<{ item: { bindings: unknown[]; uploadCandidateId: string | null;
      decisionProofDigest: string | null;
      targets: Array<{ ordinal: number; decision: string; draftId: string | null }> } }>(
      route(reviewer), `${path}/source-diff`);
    expect(diff.status).toBe(200);
    expect(diff.body.item.bindings).toHaveLength(3);
    expect(diff.body.item.targets.map((entry) => entry.ordinal)).toEqual([0, 1]);
    expect(diff.body.item.targets.map((entry) => [entry.decision, entry.draftId]))
      .toEqual([["file", null], ["file", null]]);
    expect(diff.body.item.uploadCandidateId).toBeNull();
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const draftRowsBefore = (await db.query<{ snapshot: unknown }>(`
      select to_jsonb(draft) as snapshot from project_parameter_value_drafts draft
       where draft.organization_id=$1 and draft.project_id=$2 order by draft.id`, [ORG, PROJECT])).rows;
    const wrong = await requestJson(route(reviewer), `${path}/review`, { method: "POST",
      body: JSON.stringify({ decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
        draftImpactDigest: "0".repeat(64) }) });
    expect(wrong.status).toBe(409);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    const approved = await requestJson(route(reviewer), `${path}/review`, { method: "POST",
      body: JSON.stringify({ decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
        draftImpactDigest: submitted.body.item.draftImpactDigest }) });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ item: { status: "approved" } });
    const after = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    expect(after.values).toHaveLength(before.values.length + 3);
    expect(after.pins).toHaveLength(before.pins.length + 3);
    expect(after.history).toHaveLength(before.history.length + 3);
    expect(after.versions).toHaveLength(before.versions.length + 1);
    expect(after.revisions).toHaveLength(before.revisions.length + 1);
    expect(after.drafts).toEqual(before.drafts);
    expect((await db.query<{ snapshot: unknown }>(`
      select to_jsonb(draft) as snapshot from project_parameter_value_drafts draft
       where draft.organization_id=$1 and draft.project_id=$2 order by draft.id`, [ORG, PROJECT])).rows)
      .toEqual(draftRowsBefore);
    const replay = await requestJson(route(reviewer), `${path}/review`, { method: "POST",
      body: JSON.stringify({ decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
        draftImpactDigest: submitted.body.item.draftImpactDigest }) });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(approved.body);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(after);
    const values = (await db.query<{ id: string; value: unknown }>(`
      select binding.id,value.value from parameter_catalog.project_parameter_bindings binding
        join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
       where binding.organization_id=$1 and binding.project_id=$2 order by binding.id`, [ORG, PROJECT])).rows;
    expect(values).toHaveLength(3);
    expect(values.map((entry) => entry.value).sort((a, b) => Number(a) - Number(b))).toEqual([30, 50, 60]);
    const drafts = (await db.query<{ id: string; target_value: unknown; base_current_value_id: string;
      current_value_id: string }>(`select draft.id,draft.target_value,draft.base_current_value_id,
        binding.current_value_id from project_parameter_value_drafts draft
        join parameter_catalog.project_parameter_bindings binding on binding.id=draft.binding_id
       where draft.organization_id=$1 and draft.project_id=$2 order by draft.id`, [ORG, PROJECT])).rows;
    expect(drafts.map((row) => row.id).sort()).toEqual([firstDraft.id, siblingDraft.id].sort());
    expect(drafts.every((row) => row.base_current_value_id !== row.current_value_id)).toBe(true);
    expect(drafts.every((row) => JSON.stringify(row.target_value).includes("88"))).toBe(true);
  }, 120_000);

  it("keeps an older pending draft target without composition proof out of the file writer", async () => {
    const { item, preview } = await candidate();
    const target = preview.bindings![0]!.bindingId;
    const competing = await draft(target);
    const submitPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string } }>(route(), submitPath, { method: "POST", body: JSON.stringify({
      candidateId: item.id, expectedProofToken: preview.proofToken, reason: "File-only baseline",
      assignedToUserId: REVIEWER, targetDecisions: [{ bindingId: target, choice: "file",
        expectedConflictProofs: await expectedConflicts(item.id, target, "file") }]
    }) });
    expect(submitted.status).toBe(201);
    const originalPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}`;
    expect((await requestJson(route(), `${originalPath}/withdraw`, { method: "POST" })).status).toBe(200);
    const oldId = "pvcr_906_older_mixed_without_proof";
    await db.transaction(async (tx) => {
      await tx.query(`insert into public.project_parameter_value_change_requests
        select (jsonb_populate_record(null::public.project_parameter_value_change_requests,
          to_jsonb(request) || jsonb_build_object('id',$2::text,'status','pending',
            'reviewer_user_id',null))).*
          from public.project_parameter_value_change_requests request where request.id=$1`,
      [submitted.body.item.id, oldId]);
      await tx.query(`insert into public.project_parameter_value_change_targets
        select (jsonb_populate_record(null::public.project_parameter_value_change_targets,
          to_jsonb(target) || jsonb_build_object('id',target.id || '_old','request_id',$2::text,
            'draft_id',case when target.binding_id=$3 then $4::text else null end))).*
          from public.project_parameter_value_change_targets target where target.request_id=$1`,
      [submitted.body.item.id, oldId, target, competing.id]);
    });
    const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${oldId}`;
    const detail = await requestJson<{ item: { compositionProof: unknown;
      targets: Array<{ bindingId: string; decision: string; draftId: string | null;
        targetValue: unknown; targetText: string | null }> } }>(route(reviewer), `${path}/batch`);
    expect(detail.status).toBe(200);
    expect(detail.body.item.compositionProof).toBeNull();
    expect(detail.body.item.targets.find((entry) => entry.bindingId === target))
      .toMatchObject({ decision: "unverified-draft", draftId: competing.id,
        targetValue: null, targetText: null });
    expect(await requestJson(route(reviewer), `${path}/source-diff`)).toMatchObject({
      status: 409, body: { error: { details: {
        reason: "canonical-batch-draft-composition-unavailable" } } }
    });
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectsBefore = await objectBytes(storageDirectory);
    const refused = await requestJson(route(reviewer), `${path}/review`, { method: "POST", body: JSON.stringify({
      decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
      draftImpactDigest: submitted.body.item.draftImpactDigest
    }) });
    expect(refused).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-draft-composition-unavailable" } } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objectBytes(storageDirectory)).toEqual(objectsBefore);
    await removeCanonicalValueDraft(db, author, { projectId: PROJECT, draftId: competing.id });
    const afterDraftDeletion = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectsAfterDraftDeletion = await objectBytes(storageDirectory);
    const deletedDraftDetail = await requestJson<{ item: {
      targets: Array<{ bindingId: string; decision: string; draftId: string | null;
        targetValue: unknown; targetText: string | null }> } }>(route(reviewer), `${path}/batch`);
    expect(deletedDraftDetail.status).toBe(200);
    expect(deletedDraftDetail.body.item.targets.find((entry) => entry.bindingId === target))
      .toMatchObject({ decision: "unverified-draft", draftId: competing.id,
        targetValue: null, targetText: null });
    expect(await requestJson(route(reviewer), `${path}/source-diff`)).toMatchObject({
      status: 409, body: { error: { details: {
        reason: "canonical-batch-draft-composition-unavailable" } } }
    });
    expect(await requestJson(route(reviewer), `${path}/review`, { method: "POST", body: JSON.stringify({
      decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
      draftImpactDigest: submitted.body.item.draftImpactDigest
    }) })).toMatchObject({ status: 409 });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT }))
      .toEqual(afterDraftDeletion);
    expect(await objectBytes(storageDirectory)).toEqual(objectsAfterDraftDeletion);
    await expect(db.query(`insert into public.project_parameter_value_change_requests
      select (jsonb_populate_record(null::public.project_parameter_value_change_requests,
        to_jsonb(request) || jsonb_build_object('id','pvcr_906_partial_composition',
          'status','rejected','batch_upload_candidate_id',$2::text))).*
        from public.project_parameter_value_change_requests request where request.id=$1`,
    [submitted.body.item.id, item.id])).rejects.toMatchObject({
      code: "23514", constraint: "project_parameter_value_change_requests_composition_ck"
    });
    await expect(db.query(`insert into public.project_parameter_value_change_requests
      select (jsonb_populate_record(null::public.project_parameter_value_change_requests,
        to_jsonb(request) || jsonb_build_object('id','pvcr_906_incomplete_composition',
          'status','rejected','batch_upload_candidate_id',$2::text,
          'batch_composition_proof','{}'::jsonb,'batch_decision_proof_digest',$3::text))).*
        from public.project_parameter_value_change_requests request where request.id=$1`,
    [submitted.body.item.id, item.id, "0".repeat(64)])).rejects.toMatchObject({
      code: "23514", constraint: "project_parameter_value_change_requests_composition_ck"
    });
    await expect(db.query(`update public.project_parameter_value_change_requests
      set batch_upload_candidate_id=$2 where id=$1`, [oldId, item.id]))
      .rejects.toMatchObject({ code: "55000" });
  }, 120_000);

  it("rejects a newly inserted sibling draft under source locks without any partial apply", async () => {
    const { item, preview } = await candidate();
    const sibling = bindings.find((id) => !preview.bindings!.some((entry) => entry.bindingId === id))!;
    const first = await draft(sibling);
    const submitPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string } }>(route(), submitPath, { method: "POST", body: JSON.stringify({
        candidateId: item.id, expectedProofToken: preview.proofToken,
        reason: "Freeze sibling draft", assignedToUserId: REVIEWER
      }) });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    await draft(sibling, secondAuthor, 89);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objects = await objectBytes(storageDirectory);
    const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/review`;
    const review = await requestJson(route(reviewer), path, { method: "POST", body: JSON.stringify({
      decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
      draftImpactDigest: submitted.body.item.draftImpactDigest
    }) });
    expect(review).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-draft-impact-stale" } } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objectBytes(storageDirectory)).toEqual(objects);
    expect((await db.query<{ id: string }>(`select id from project_parameter_value_drafts
      where id=$1`, [first.id])).rows).toHaveLength(1);
  }, 120_000);

  it("rejects a changed target draft after submission without changing the pending request", async () => {
    const { item, preview } = await candidate();
    const target = preview.bindings![0]!.bindingId;
    const original = await draft(target);
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", body: JSON.stringify({ candidateId: item.id,
          expectedProofToken: preview.proofToken, reason: "Freeze target draft",
          assignedToUserId: REVIEWER, targetDecisions: [{ bindingId: target, choice: "file",
            expectedConflictProofs: await expectedConflicts(item.id, target, "file") }] })
      });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const changed = await draft(target, author, 89);
    expect(changed.id).toBe(original.id);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objects = await objectBytes(storageDirectory);
    const review = await requestJson(route(reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/review`, {
        method: "POST", body: JSON.stringify({ decision: "approve",
          batchProofDigest: submitted.body.item.batchProofDigest,
          draftImpactDigest: submitted.body.item.draftImpactDigest })
      });
    expect(review).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-draft-impact-stale" } } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objectBytes(storageDirectory)).toEqual(objects);
  }, 120_000);

  it("rolls back three Value and pin writes after a late audit fault, then retries the same request", async () => {
    const { item, preview } = await candidate();
    const target = preview.bindings![0]!.bindingId;
    const sibling = bindings.find((id) => !preview.bindings!.some((entry) => entry.bindingId === id))!;
    const firstDraft = await draft(target);
    const siblingDraft = await draft(sibling);
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", body: JSON.stringify({ candidateId: item.id,
          expectedProofToken: preview.proofToken, reason: "Atomic three Binding review",
          assignedToUserId: REVIEWER,
          targetDecisions: [{ bindingId: target, choice: "file",
            expectedConflictProofs: await expectedConflicts(item.id, target, "file") }] })
      });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/review`;
    const review = () => requestJson(route(reviewer), path, { method: "POST", body: JSON.stringify({
      decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
      draftImpactDigest: submitted.body.item.draftImpactDigest
    }) });
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objects = await objectBytes(storageDirectory);
    await db.query(`create function public.reject_c906_impact_audit() returns trigger language plpgsql as $$
      begin if new.action='value-change-applied'
        then raise exception 'injected late batch audit failure'; end if; return new; end $$`);
    await db.query(`create trigger reject_c906_impact_audit before insert on public.audit_events
      for each row execute function public.reject_c906_impact_audit()`);
    try {
      expect((await review()).status).toBe(500);
    } finally {
      await db.query("drop trigger reject_c906_impact_audit on public.audit_events");
      await db.query("drop function public.reject_c906_impact_audit()");
    }
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objectBytes(storageDirectory)).toEqual(objects);
    const retried = await review();
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body).toMatchObject({ item: { status: "approved" } });
    expect((await db.query<{ id: string }>(`select id from project_parameter_value_drafts
      where id=any($1::text[]) order by id`, [[firstDraft.id, siblingDraft.id]])).rows).toHaveLength(2);
  }, 120_000);

  it("rejects an older three-Binding request after a newer source commit without a second write", async () => {
    const older = await candidate();
    const target = older.preview.bindings![0]!.bindingId;
    const sibling = bindings.find((id) => !older.preview.bindings!.some((entry) => entry.bindingId === id))!;
    await draft(target);
    await draft(sibling);
    const submitPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const submit = async (candidateId: string, expectedProofToken: string) =>
      requestJson<{ item: { id: string; batchProofDigest: string; draftImpactDigest: string } }>(route(),
        submitPath, { method: "POST", body: JSON.stringify({ candidateId, expectedProofToken,
          reason: "Source drift ordering", assignedToUserId: REVIEWER,
          targetDecisions: [{ bindingId: target, choice: "file",
            expectedConflictProofs: await expectedConflicts(candidateId, target, "file") }] }) });
    const first = await submit(older.item.id, older.preview.proofToken!);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const newer = await createCandidate(db, storage, admin, { projectId: PROJECT, fileId,
      fileName: "settings.json",
      bytes: Buffer.from('{"first":{"limit":70},"second":{"limit":80},"third":{"limit":30}}\n') });
    const newerPreview = await previewCanonicalCandidate(db, storage, admin, {
      projectId: PROJECT, candidateId: newer.id
    });
    const second = await submit(newer.id, newerPreview.proofToken!);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const review = (item: typeof first.body.item) => requestJson(route(reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${item.id}/review`, {
        method: "POST", body: JSON.stringify({ decision: "approve",
          batchProofDigest: item.batchProofDigest, draftImpactDigest: item.draftImpactDigest })
      });
    expect((await review(second.body.item)).status).toBe(200);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objects = await objectBytes(storageDirectory);
    expect((await review(first.body.item)).status).toBe(409);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
  }, 120_000);
});
