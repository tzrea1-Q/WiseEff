import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { createLocalObjectStore } from "../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { asAuditTx } from "../audit/auditedWrite";
import { createUserInvocation } from "../auth/trustedInvocation";
import { writeTrustedGovernanceAudit } from "../parameter-topology/governanceAudit";
import { captureConfigurationSourceState, installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { loadProjectValueById } from "../parameter-bindings/values/repositories";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { parseDtsValue } from "../dts";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import { createCandidate } from "./candidateService";
import { linkParameterFileCandidateToCanonicalWorkflow } from "./candidateRepository";
import { registerParameterFileRoutes } from "./routes";
import { createCanonicalValueDraft, listCanonicalValueDraftsForReviewer } from "../parameter-bindings/drafts/service";
import { reviewCanonicalValueChange, submitCanonicalValueChange } from "../parameter-bindings/drafts/changeService";
import {
  prepareCanonicalConflictDecision,
  previewCanonicalCandidate,
  submitCanonicalConflictDecision
} from "./canonicalFileWorkflow";

const ORG = "org-906-conflict";
const PROJECT = "project-906-conflict";
const DTS_PROJECT = "project-906-conflict-dts";
const ADMIN = "user-906-conflict-admin";
const AUTHOR = "user-906-conflict-author";
const REVIEWER = "user-906-conflict-reviewer";
const DEF = "pdef_acme_power_iin_max";
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const author = makeTestAuthContext({ userId: AUTHOR, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: PROJECT }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const dtsReviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: DTS_PROJECT }] });
const foreign = makeTestAuthContext({ userId: "foreign-admin", organizationId: "foreign-org",
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });

type Fixture = Awaited<ReturnType<typeof fixture>>;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

async function fixture() {
  const database = await createEphemeralTestDatabase("issue906-conflict-decision");
  const db = createPostgresDatabase(database.url);
  const directory = await mkdtemp(join(tmpdir(), "wiseeff-906-conflict-"));
  const storage = createLocalObjectStore(directory);
  cleanups.push(async () => { await db.close(); await database.drop(); await rm(directory, { recursive: true, force: true }); });
  await db.query("insert into organizations(id,name) values ($1,'#906 conflict')", [ORG]);
  await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'author','Author',true),($4,$2,'reviewer','Reviewer',true)",
    [ADMIN, ORG, AUTHOR, REVIEWER]);
  await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Conflict','C906','initialized')", [PROJECT, ORG]);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('conflict-admin',$1,$2,null,'admin'),('conflict-author',$3,$2,$4,'software-user'),('conflict-reviewer',$5,$2,$4,'software-committer')",
    [ADMIN, ORG, AUTHOR, PROJECT, REVIEWER]);
  await installConfigurationSourceFixture(db, admin, { subjectId: "csub_906_conflict", schemaId: "wiseeff.906.conflict" });
  const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "Conflict" });
  const uploaded = await uploadProjectParameterFile(db, storage, admin, {
    projectId: PROJECT, fileName: "settings.json",
    bytes: Buffer.from('{ "settings": { "limit": 36.5 }, "other": { "limit": 48 } }\n')
  });
  await addConfigSetFile(db, admin, { configSetId: set.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
  const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
  if (!snapshot) throw new Error("Published Catalog fixture unavailable");
  const first = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
    projectId: PROJECT, configSetId: set.id, fileId: uploaded.file.id,
    fileVersionId: uploaded.version.id, configurationSchemaId: "wiseeff.906.conflict",
    rootPointer: "", mappings: [{ definitionId: DEF, pointer: "/settings/limit" }],
    invocation: createUserInvocation(admin), requestId: "906-conflict-register-first",
    refusalSink: createTrustedRefusalAuditSink(db)
  }));
  const second = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
    projectId: PROJECT, configSetId: set.id, fileId: uploaded.file.id,
    fileVersionId: uploaded.version.id, configurationSchemaId: "wiseeff.906.conflict",
    rootPointer: "/other", mappings: [{ definitionId: DEF, pointer: "/other/limit" }],
    invocation: createUserInvocation(admin), requestId: "906-conflict-register-second",
    refusalSink: createTrustedRefusalAuditSink(db)
  }));
  const bindingId = first.bindings[0]!.id;
  const otherBindingId = second.bindings[0]!.id;
  const pin = await loadOwnedProjectValueSourcePin(db, {
    organizationId: ORG, projectId: PROJECT, bindingId,
    projectValueId: first.bindings[0]!.currentValueId
  });
  if (!pin) throw new Error("Canonical-only source pin unavailable");
  const uiDraft = await createCanonicalValueDraft(db, author, {
    projectId: PROJECT, bindingId, sourceTarget: { format: "json", sourceText: "99" },
    reason: "UI work", baseRevisionId: pin.configRevisionId,
    baseCurrentValueId: first.bindings[0]!.currentValueId
  }, { objectStore: storage, invocation: createUserInvocation(author),
    requestId: "906-conflict-ui-draft", refusalSink: createTrustedRefusalAuditSink(db) });
  const otherPin = await loadOwnedProjectValueSourcePin(db, {
    organizationId: ORG, projectId: PROJECT, bindingId: otherBindingId,
    projectValueId: second.bindings[0]!.currentValueId
  });
  if (!otherPin) throw new Error("Sibling source pin unavailable");
  const unselectedDraft = await createCanonicalValueDraft(db, author, {
    projectId: PROJECT, bindingId: otherBindingId,
    sourceTarget: { format: "json", sourceText: "88" },
    reason: "unselected author work", baseRevisionId: otherPin.configRevisionId,
    baseCurrentValueId: second.bindings[0]!.currentValueId
  }, { objectStore: storage, invocation: createUserInvocation(author),
    requestId: "906-conflict-other-draft", refusalSink: createTrustedRefusalAuditSink(db) });
  const candidate = await createCandidate(db, storage, admin, {
    projectId: PROJECT, fileId: uploaded.file.id, fileName: "settings.json",
    bytes: Buffer.from('{ "settings": { "limit": 50 }, "other": { "limit": 60 } }\n')
  });
  const singleCandidate = await createCandidate(db, storage, admin, {
    projectId: PROJECT, fileId: uploaded.file.id, fileName: "settings.json",
    bytes: Buffer.from('{ "settings": { "limit": 50 }, "other": { "limit": 48 } }\n')
  });
  return { db, storage, directory, candidate, singleCandidate, uiDraft, unselectedDraft, bindingId, otherBindingId,
    fileId: uploaded.file.id, baseVersionId: uploaded.version.id };
}

async function state({ db, fileId }: Fixture) {
  const [source, conflicts, semanticDrafts] = await Promise.all([
    captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT }),
    db.query("select id from parameter_file_sync_conflicts where organization_id=$1 and project_id=$2", [ORG, PROJECT]),
    db.query("select id from parameter_drafts where organization_id=$1 and project_id=$2", [ORG, PROJECT])
  ]);
  return { source, conflicts: conflicts.rows, semanticDrafts: semanticDrafts.rows };
}

async function approve(f: Fixture, requestId: string, storage = f.storage) {
  const catalog = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
  if (!catalog) throw new Error("Published Catalog fixture unavailable");
  return reviewCanonicalValueChange(f.db, reviewer,
    { projectId: PROJECT, requestId, decision: "approve" },
    { objectStore: storage, snapshot: catalog, invocation: createUserInvocation(reviewer),
      traceId: `906-conflict-review:${requestId}`, refusalSink: createTrustedRefusalAuditSink(f.db) });
}

async function storedFiles(directory: string) {
  return (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
}

async function storedObjects(directory: string) {
  const entries = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile());
  return Promise.all(entries.map(async (entry) => ({
    key: relative(directory, join(entry.parentPath, entry.name)),
    bytes: (await readFile(join(entry.parentPath, entry.name))).toString("base64")
  }))).then((objects) => objects.sort((a, b) => a.key.localeCompare(b.key)));
}

async function pendingConflictWithoutDecisionReceipt(f: Fixture) {
  const decision = await prepareCanonicalConflictDecision(f.db, f.storage, admin, {
    projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
    selectedDraftId: f.uiDraft.id, choice: "file"
  });
  const draft = await createCanonicalValueDraft(f.db, admin, {
    projectId: PROJECT, bindingId: f.bindingId,
    sourceTarget: { format: "json", sourceText: decision.targetText! },
    reason: "review selected file", baseRevisionId: decision.selectedRevisionId,
    baseCurrentValueId: decision.selectedBaseValueId
  }, { objectStore: f.storage, invocation: createUserInvocation(admin),
    requestId: "906-conflict-missing-receipt-draft", refusalSink: createTrustedRefusalAuditSink(f.db) });
  const request = await submitCanonicalValueChange(f.db, admin, {
    projectId: PROJECT, draftId: draft.id, assignedToUserId: REVIEWER,
    invocation: createUserInvocation(admin), requestId: "906-conflict-missing-receipt-submit",
    refusalSink: createTrustedRefusalAuditSink(f.db)
  });
  const linked = await linkParameterFileCandidateToCanonicalWorkflow(f.db, {
    organizationId: ORG, projectId: PROJECT, candidateId: f.candidate.id,
    link: {
      kind: "canonical-source", fingerprint: decision.decisionProofDigest,
      bindingId: f.bindingId, sourcePinId: decision.selectedSourcePinId,
      preparedCandidateId: draft.candidateId!, draftId: draft.id, requestId: request.id,
      status: request.status,
      conflictDecision: {
        choice: "file", selectedDraftId: f.uiDraft.id,
        selectedDraftCandidateId: decision.selectedDraftCandidateId,
        selectedDraftCandidateDigest: decision.selectedDraftCandidateDigest,
        sourceProofToken: decision.sourceProofToken,
        sourceCandidateDigest: decision.sourceCandidateDigest,
        decisionProofDigest: decision.decisionProofDigest
      }
    }
  });
  expect(linked?.impact?.canonicalSourceWorkflow?.requestId).toBe(request.id);
  expect(linked?.impact?.canonicalSourceWorkflow?.conflictDecision?.decisionProofDigest)
    .toBe(decision.decisionProofDigest);
  return request.id;
}

describe("#906 selected canonical file/UI conflict source transaction", () => {
  it("rejects a pending linked conflict with no decision audit receipt", async () => {
    const f = await fixture();
    const requestId = await pendingConflictWithoutDecisionReceipt(f);
    const receipts = await f.db.query(`select metadata from audit_events where target_id=$1 and action='value-change-submitted'`, [requestId]);
    expect(receipts.rows).toEqual([]);
    const before = await state(f);
    const objects = await storedObjects(f.directory);
    await expect(approve(f, requestId)).rejects.toMatchObject({
      code: "CONFLICT", details: { reason: "conflict-decision-stale" }
    });
    expect(await state(f)).toEqual(before);
    expect(await storedObjects(f.directory)).toEqual(objects);
    expect((await state(f)).source.requests.find((request) => request.id === requestId)?.status).toBe("pending");
  }, 120_000);

  it("rejects a linked conflict with an unrecognizable decision receipt", async () => {
    const f = await fixture();
    const requestId = await pendingConflictWithoutDecisionReceipt(f);
    await f.db.transaction((tx) => writeTrustedGovernanceAudit(asAuditTx(tx), createUserInvocation(admin), {
      action: "value-change-submitted", organizationId: ORG, projectId: PROJECT,
      targetType: "project-parameter-value-change-request", targetId: requestId,
      metadata: { requestId, sourceCandidateId: f.candidate.id, choice: "file", selectedDraftId: f.uiDraft.id }
    }, "906-conflict-incomplete-decision-receipt"));
    const receipts = await f.db.query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_events where target_id=$1 and action='value-change-submitted'", [requestId]);
    expect(receipts.rows).toHaveLength(1);
    expect(receipts.rows.some((row) => row.metadata.sourceCandidateId === f.candidate.id
      && !Object.hasOwn(row.metadata, "decisionProofDigest"))).toBe(true);
    const before = await state(f);
    const objects = await storedObjects(f.directory);
    await expect(approve(f, requestId)).rejects.toMatchObject({
      code: "CONFLICT", details: { reason: "conflict-decision-stale" }
    });
    expect(await state(f)).toEqual(before);
    expect(await storedObjects(f.directory)).toEqual(objects);
    expect((await state(f)).source.requests.find((request) => request.id === requestId)?.status).toBe("pending");
  }, 120_000);

  it("rejects a conflict when its retained decision link disagrees with the audited proof", async () => {
    const f = await fixture();
    const decision = await prepareCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file"
    });
    const pending = await submitCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file", expectedDecisionProofDigest: decision.decisionProofDigest,
      reason: "selected file", assignedToUserId: REVIEWER, requestId: "906-conflict-proof-mismatch",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    });
    await f.db.query(`update project_parameter_file_candidates
      set impact=jsonb_set(impact, '{canonicalSourceWorkflow,fingerprint}', '"wrong-proof"'::jsonb)
      where id=$1`, [f.candidate.id]);
    const before = await state(f);
    const objects = await storedObjects(f.directory);
    await expect(approve(f, pending.requestId)).rejects.toMatchObject({
      code: "CONFLICT", details: { reason: "conflict-decision-stale" }
    });
    expect(await state(f)).toEqual(before);
    expect(await storedObjects(f.directory)).toEqual(objects);
    expect((await state(f)).source.requests.find((request) => request.id === pending.requestId)?.status).toBe("pending");
  }, 120_000);
  it("reproduces the canonical-only 409, then applies one file target with complete cohort repin and rollback", async () => {
    const f = await fixture();
    const preview = await previewCanonicalCandidate(f.db, f.storage, admin, { projectId: PROJECT, candidateId: f.candidate.id });
    expect(preview.bindings).toHaveLength(2);
    const before = await state(f);
    expect(before.conflicts).toEqual([]);
    expect(before.semanticDrafts).toEqual([]);
    const singlePreview = await previewCanonicalCandidate(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.singleCandidate.id
    });
    expect(singlePreview).toMatchObject({ kind: "canonical", canSubmit: true, bindingId: f.bindingId });
    const router = createRouter();
    registerParameterFileRoutes(router, {
      db: f.db, objectStore: f.storage, getCurrentAuthContext: () => admin
    });
    const oldSubmit = await requestJson<{ error: { code: string; details: { reason?: string } } }>(
      createHttpServer(router),
      `/api/v1/projects/${PROJECT}/parameter-file-candidates/${f.singleCandidate.id}/source-submit`,
      { method: "POST", body: JSON.stringify({
        expectedCurrentVersionId: f.baseVersionId,
        expectedProofToken: singlePreview.proofToken,
        reason: "old single path"
      }) }
    );
    expect(oldSubmit).toMatchObject({ status: 409,
      body: { error: { code: "CONFLICT", details: { reason: "existing-canonical-draft" } } } });
    expect(await state(f)).toEqual(before);
    await expect(prepareCanonicalConflictDecision(f.db, f.storage, author, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file"
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(prepareCanonicalConflictDecision(f.db, f.storage, foreign, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file"
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const prepared = await prepareCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file"
    });
    expect(prepared).toMatchObject({ action: "set", targetText: "50", baseVersionId: f.baseVersionId });
    expect(prepared.members).toHaveLength(1);
    expect(prepared.cohort.map((entry) => entry.bindingId)).toEqual(
      [...prepared.cohort.map((entry) => entry.bindingId)].sort()
    );
    await expect(submitCanonicalConflictDecision(f.db, f.storage, foreign, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file", expectedDecisionProofDigest: prepared.decisionProofDigest,
      reason: "foreign tenant", assignedToUserId: REVIEWER, requestId: "906-conflict-foreign-submit",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await state(f)).toEqual(before);
    await expect(submitCanonicalConflictDecision(f.db, f.storage, author, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file", expectedDecisionProofDigest: prepared.decisionProofDigest,
      reason: "not admin", assignedToUserId: REVIEWER, requestId: "906-conflict-denied-submit",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await state(f)).toEqual(before);
    await expect(submitCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file", expectedDecisionProofDigest: "stale",
      reason: "use file", assignedToUserId: REVIEWER, requestId: "906-conflict-stale",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source-proof-stale" } });
    expect(await state(f)).toEqual(before);
    const objectFiles = await storedFiles(f.directory);
    await f.db.query(`create function public.reject_conflict_submit() returns trigger language plpgsql as $$
      begin if new.action='value-change-submitted' then raise exception 'late submit audit failure'; end if; return new; end $$`);
    await f.db.query("create trigger reject_conflict_submit before insert on audit_events for each row execute function public.reject_conflict_submit()");
    await expect(submitCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file", expectedDecisionProofDigest: prepared.decisionProofDigest,
      reason: "use file", assignedToUserId: REVIEWER, requestId: "906-conflict-submit-fault",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    })).rejects.toThrow("late submit audit failure");
    expect(await state(f)).toEqual(before);
    expect(await storedFiles(f.directory)).toEqual(objectFiles);
    await f.db.query("drop trigger reject_conflict_submit on audit_events");
    await f.db.query("drop function public.reject_conflict_submit()");
    const submitted = await submitCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file", expectedDecisionProofDigest: prepared.decisionProofDigest,
      reason: "use file", assignedToUserId: REVIEWER, requestId: "906-conflict-file-submit",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    });
    expect(submitted).toMatchObject({ status: "pending", replayed: false });
    expect(await submitCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file", expectedDecisionProofDigest: prepared.decisionProofDigest,
      reason: "use file", assignedToUserId: REVIEWER, requestId: "906-conflict-file-retry",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    })).toMatchObject({ requestId: submitted.requestId, replayed: true });
    const pending = (await f.db.query<{ candidate_id: string; binding_id: string }>(
      "select candidate_id,binding_id from project_parameter_value_change_requests where id=$1", [submitted.requestId])).rows[0]!;
    expect(pending.binding_id).toBe(f.bindingId);
    const derived = (await f.db.query<{ storage_key: string }>(
      "select storage_key from project_parameter_file_candidates where id=$1", [pending.candidate_id])).rows[0]!;
    expect((await f.storage.get(derived.storage_key)).toString()).toContain('"limit": 48');
    expect((await f.storage.get(derived.storage_key)).toString()).toContain('"limit": 50');
    await f.db.query(`create function public.reject_conflict_apply() returns trigger language plpgsql as $$
      begin if new.action='value-change-applied' then raise exception 'late audit failure'; end if; return new; end $$`);
    await f.db.query("create trigger reject_conflict_apply before insert on audit_events for each row execute function public.reject_conflict_apply()");
    const snapshot = await state(f);
    await expect(approve(f, submitted.requestId)).rejects.toThrow("late audit failure");
    expect(await state(f)).toEqual(snapshot);
    await f.db.query("drop trigger reject_conflict_apply on audit_events");
    await f.db.query("drop function public.reject_conflict_apply()");
    expect((await approve(f, submitted.requestId)).status).toBe("approved");
    const after = await state(f);
    expect(after.source.files).not.toEqual(before.source.files);
    expect(after.source.bindings).not.toEqual(before.source.bindings);
    expect(after.source.drafts).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.uiDraft.id })]));
    expect(after.source.drafts).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.unselectedDraft.id })]));
    expect(after.source.values.length).toBe(before.source.values.length + 2);
    expect(after.source.pins.length).toBe(before.source.pins.length + 2);
    expect(after.source.history.length).toBe(before.source.history.length + 2);
    const activeVersionId = after.source.files.find((file) => file.id === f.fileId)!.currentVersionId!;
    const activePins = await Promise.all(after.source.bindings.map((binding) =>
      loadOwnedProjectValueSourcePin(f.db, {
        organizationId: ORG, projectId: PROJECT,
        bindingId: binding.id, projectValueId: binding.currentValueId
      })));
    expect(activePins.every((pin) => pin?.fileVersionId === activeVersionId)).toBe(true);
    expect(new Set(activePins.map((pin) => pin?.configRevisionId)).size).toBe(1);
    const sibling = after.source.bindings.find((binding) => binding.id === f.otherBindingId);
    const current = await loadProjectValueById(asValueClient(f.db), sibling!.currentValueId);
    expect(current?.value).toEqual(48);
    const drafts = await listCanonicalValueDraftsForReviewer(f.db, reviewer, { projectId: PROJECT, bindingId: f.bindingId });
    expect(drafts.find((draft) => draft.draftId === f.uiDraft.id)?.stale).toBe(true);
    const otherDrafts = await listCanonicalValueDraftsForReviewer(f.db, reviewer, {
      projectId: PROJECT, bindingId: f.otherBindingId
    });
    expect(otherDrafts.find((draft) => draft.draftId === f.unselectedDraft.id)?.stale).toBe(true);
  }, 120_000);

  it("chooses the selected UI draft, rejects altered candidate bytes, then resumes the same request", async () => {
    const f = await fixture();
    const decision = await prepareCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "draft"
    });
    expect(decision).toMatchObject({ action: "set", targetText: "99" });
    const submitted = await submitCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "draft", expectedDecisionProofDigest: decision.decisionProofDigest,
      reason: "use UI", assignedToUserId: REVIEWER, requestId: "906-conflict-ui-submit",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    });
    const pending = await state(f);
    const poisoned = { ...f.storage,
      getBounded: async (key: string, max: number) => {
        const bytes = await f.storage.getBounded!(key, max);
        const original = (await f.db.query<{ storage_key: string }>(
          "select storage_key from project_parameter_file_candidates where id=$1", [f.candidate.id])).rows[0]!.storage_key;
        return key === original ? Buffer.from("tampered") : bytes;
      }
    };
    await expect(approve(f, submitted.requestId, poisoned)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await state(f)).toEqual(pending);
    expect((await approve(f, submitted.requestId)).status).toBe("approved");
    const after = await state(f);
    expect(after.source.requests.find((request) => request.id === submitted.requestId)?.status).toBe("approved");
    expect(after.source.drafts).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.uiDraft.id })]));
    const sibling = after.source.bindings.find((binding) => binding.id === f.otherBindingId);
    expect((await loadProjectValueById(asValueClient(f.db), sibling!.currentValueId))?.value).toEqual(48);
    const chosen = after.source.bindings.find((binding) => binding.id === f.bindingId);
    expect((await loadProjectValueById(asValueClient(f.db), chosen!.currentValueId))?.value).toEqual(99);
    await expect(submitCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file", expectedDecisionProofDigest: decision.decisionProofDigest,
      reason: "wrong replay", assignedToUserId: REVIEWER, requestId: "906-conflict-wrong-replay",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "conflict-decision-replay-mismatch" } });
  }, 120_000);

  it("rejects a replaced selected draft and a repinned source with no decision write", async () => {
    const f = await fixture();
    const prepared = await prepareCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "draft"
    });
    const pin = await loadOwnedProjectValueSourcePin(f.db, {
      organizationId: ORG, projectId: PROJECT,
      bindingId: f.bindingId, projectValueId: prepared.selectedBaseValueId
    });
    if (!pin) throw new Error("Selected pin missing");
    await createCanonicalValueDraft(f.db, author, {
      projectId: PROJECT, bindingId: f.bindingId,
      sourceTarget: { format: "json", sourceText: "97" },
      reason: "author edited again", baseRevisionId: pin.configRevisionId,
      baseCurrentValueId: prepared.selectedBaseValueId
    }, { objectStore: f.storage, invocation: createUserInvocation(author),
      requestId: "906-conflict-edit-ui-draft", refusalSink: createTrustedRefusalAuditSink(f.db) });
    const afterDraftEdit = await state(f);
    await expect(submitCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "draft", expectedDecisionProofDigest: prepared.decisionProofDigest,
      reason: "stale UI choice", assignedToUserId: REVIEWER,
      requestId: "906-conflict-old-ui-proof", refusalSink: createTrustedRefusalAuditSink(f.db)
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source-proof-stale" } });
    expect(await state(f)).toEqual(afterDraftEdit);

    const currentProof = await prepareCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file"
    });
    const siblingPin = await loadOwnedProjectValueSourcePin(f.db, {
      organizationId: ORG, projectId: PROJECT,
      bindingId: f.otherBindingId,
      projectValueId: afterDraftEdit.source.bindings.find((row) => row.id === f.otherBindingId)!.currentValueId
    });
    if (!siblingPin) throw new Error("Sibling source pin unavailable");
    const siblingDraft = await createCanonicalValueDraft(f.db, admin, {
      projectId: PROJECT, bindingId: f.otherBindingId,
      sourceTarget: { format: "json", sourceText: "61" },
      reason: "genuine sibling source revision", baseRevisionId: siblingPin.configRevisionId,
      baseCurrentValueId: siblingPin.projectValueId
    }, { objectStore: f.storage, invocation: createUserInvocation(admin),
      requestId: "906-conflict-sibling-draft", refusalSink: createTrustedRefusalAuditSink(f.db) });
    const sibling = await submitCanonicalValueChange(f.db, admin, {
      projectId: PROJECT, draftId: siblingDraft.id, assignedToUserId: REVIEWER,
      invocation: createUserInvocation(admin), requestId: "906-conflict-sibling-submit",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    });
    const ordinaryReceipt = await f.db.query(`select id from audit_events where target_id=$1
      and action='value-change-submitted' and metadata ? 'decisionProofDigest'`, [sibling.id]);
    const ordinaryLink = await f.db.query(`select id from project_parameter_file_candidates
      where impact->'canonicalSourceWorkflow'->>'requestId'=$1
        and impact->'canonicalSourceWorkflow'->'conflictDecision' is not null`, [sibling.id]);
    expect(ordinaryReceipt.rows).toEqual([]);
    expect(ordinaryLink.rows).toEqual([]);
    expect((await approve(f, sibling.id)).status).toBe("approved");
    const afterRepin = await state(f);
    await expect(submitCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file", expectedDecisionProofDigest: currentProof.decisionProofDigest,
      reason: "stale source", assignedToUserId: REVIEWER,
      requestId: "906-conflict-old-source-proof", refusalSink: createTrustedRefusalAuditSink(f.db)
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await state(f)).toEqual(afterRepin);
  }, 120_000);

  it("keeps a pending decision inert after its audit link is lost or the source changes", async () => {
    const f = await fixture();
    const choice = await prepareCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file"
    });
    const pending = await submitCanonicalConflictDecision(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: f.candidate.id, selectedBindingId: f.bindingId,
      selectedDraftId: f.uiDraft.id, choice: "file", expectedDecisionProofDigest: choice.decisionProofDigest,
      reason: "selected file", assignedToUserId: REVIEWER, requestId: "906-conflict-pending-drift",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    });
    const impact = (await f.db.query<{ impact: unknown }>(
      "select impact from project_parameter_file_candidates where id=$1", [f.candidate.id])).rows[0]!.impact;
    const decisionReceipts = await f.db.query(`select id from audit_events where target_id=$1
      and action='value-change-submitted' and metadata ? 'decisionProofDigest'`, [pending.requestId]);
    expect(decisionReceipts.rows).toHaveLength(1);
    await f.db.query("update project_parameter_file_candidates set impact=impact-'canonicalSourceWorkflow' where id=$1", [f.candidate.id]);
    const lostLink = await state(f);
    const objects = await storedObjects(f.directory);
    await expect(approve(f, pending.requestId)).rejects.toMatchObject({
      code: "CONFLICT", details: { reason: "conflict-decision-stale" }
    });
    expect(await state(f)).toEqual(lostLink);
    expect(await storedObjects(f.directory)).toEqual(objects);
    expect((await state(f)).source.requests.find((request) => request.id === pending.requestId)?.status).toBe("pending");
    await f.db.query("update project_parameter_file_candidates set impact=$2::jsonb where id=$1",
      [f.candidate.id, JSON.stringify(impact)]);
    const current = (await state(f)).source.bindings.find((row) => row.id === f.otherBindingId)!;
    const pin = await loadOwnedProjectValueSourcePin(f.db, {
      organizationId: ORG, projectId: PROJECT,
      bindingId: f.otherBindingId, projectValueId: current.currentValueId
    });
    if (!pin) throw new Error("Sibling source pin unavailable");
    const draft = await createCanonicalValueDraft(f.db, admin, {
      projectId: PROJECT, bindingId: f.otherBindingId,
      sourceTarget: { format: "json", sourceText: "61" },
      reason: "new source revision", baseRevisionId: pin.configRevisionId,
      baseCurrentValueId: current.currentValueId
    }, { objectStore: f.storage, invocation: createUserInvocation(admin),
      requestId: "906-conflict-drift-draft", refusalSink: createTrustedRefusalAuditSink(f.db) });
    const sibling = await submitCanonicalValueChange(f.db, admin, {
      projectId: PROJECT, draftId: draft.id, assignedToUserId: REVIEWER,
      invocation: createUserInvocation(admin), requestId: "906-conflict-drift-submit",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    });
    expect((await approve(f, sibling.id)).status).toBe("approved");
    const drifted = await state(f);
    await expect(approve(f, pending.requestId)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await state(f)).toEqual(drifted);
    expect(drifted.source.requests.find((request) => request.id === pending.requestId)?.status).toBe("pending");
  }, 120_000);
});

describe("#906 selected DTS conflict target", () => {
  it("applies one reviewed file value and preserves the other candidate value", async () => {
    const database = await createEphemeralTestDatabase("issue906-dts-conflict-decision");
    const db = createPostgresDatabase(database.url);
    const directory = await mkdtemp(join(tmpdir(), "wiseeff-906-dts-conflict-"));
    const storage = createLocalObjectStore(directory);
    cleanups.push(async () => { await db.close(); await database.drop(); await rm(directory, { recursive: true, force: true }); });
    await db.query("insert into organizations(id,name) values ($1,'#906 DTS conflict')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true)",
      [ADMIN, ORG, REVIEWER]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'DTS conflict','D906','initialized')",
      [DTS_PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('dts-conflict-admin',$1,$2,null,'admin'),('dts-conflict-reviewer',$3,$2,$4,'software-committer')",
      [ADMIN, ORG, REVIEWER, DTS_PROJECT]);
    await installDriverSourceFixture(db, admin, {
      subjectId: "csub_acme_power", compatible: "acme,power",
      businessName: "#906 DTS conflict", driverName: "Acme power",
      idempotencyKey: "906-dts-conflict-registration", reason: "Issue 906 conflict choice"
    });
    const set = await createConfigSet(db, admin, { projectId: DTS_PROJECT, name: "DTS conflict" });
    const source = `/dts-v1/;\n/ {\n  charger: device@0 {\n    compatible = "acme,power";\n    iin_max = <36>;\n  };\n  backup: device@1 {\n    compatible = "acme,power";\n    iin_max = <36>;\n  };\n};\n`;
    const uploaded = await uploadProjectParameterFile(db, storage, admin, {
      projectId: DTS_PROJECT, fileName: "board.dts", bytes: Buffer.from(source)
    });
    await addConfigSetFile(db, admin, {
      configSetId: set.id, fileId: uploaded.file.id, role: "base", sortOrder: 0
    });
    const manifest: ConfigRevisionManifest = {
      organizationId: ORG, projectId: DTS_PROJECT, configSetId: set.id,
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
        fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: source }]
    };
    const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture unavailable");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
      organizationId: ORG, projectId: DTS_PROJECT,
      configSetId: set.id, configRevisionId: revision.id
    }));
    expect(await listCatalogBindingRowsForProject(db, admin, { projectId: DTS_PROJECT })).toHaveLength(2);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: DTS_PROJECT });
    const candidate = await createCandidate(db, storage, admin, {
      projectId: DTS_PROJECT, fileId: uploaded.file.id, fileName: "board.dts",
      bytes: Buffer.from(source.replace("iin_max = <36>", "iin_max = <50>")
        .replace("iin_max = <36>", "iin_max = <60>"))
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, {
      projectId: DTS_PROJECT, candidateId: candidate.id
    });
    expect(preview.bindings).toHaveLength(2);
    const selected = preview.bindings?.find((binding) => binding.afterText === "<50>");
    if (!selected) throw new Error("Selected DTS target was not proved");
    const uiDraft = await createCanonicalValueDraft(db, admin, {
      projectId: DTS_PROJECT, bindingId: selected.bindingId,
      targetValue: parseDtsValue("iin_max", "<99>").value,
      reason: "UI value", baseRevisionId: selected.configRevisionId,
      baseCurrentValueId: selected.baseCurrentValueId
    }, { objectStore: storage, invocation: createUserInvocation(admin),
      requestId: "906-dts-conflict-ui-draft", refusalSink: createTrustedRefusalAuditSink(db) });
    const choice = await prepareCanonicalConflictDecision(db, storage, admin, {
      projectId: DTS_PROJECT, candidateId: candidate.id,
      selectedBindingId: selected.bindingId, selectedDraftId: uiDraft.id, choice: "file"
    });
    expect(choice).toMatchObject({ action: "set", targetText: "<50>", baseVersionId: uploaded.version.id });
    const submitted = await submitCanonicalConflictDecision(db, storage, admin, {
      projectId: DTS_PROJECT, candidateId: candidate.id,
      selectedBindingId: selected.bindingId, selectedDraftId: uiDraft.id,
      choice: "file", expectedDecisionProofDigest: choice.decisionProofDigest,
      reason: "review selected DTS file value", assignedToUserId: REVIEWER,
      requestId: "906-dts-conflict-file-submit", refusalSink: createTrustedRefusalAuditSink(db)
    });
    expect(submitted.status).toBe("pending");
    expect((await reviewCanonicalValueChange(db, dtsReviewer,
      { projectId: DTS_PROJECT, requestId: submitted.requestId, decision: "approve" },
      { objectStore: storage, snapshot: catalog, invocation: createUserInvocation(dtsReviewer),
        traceId: "906-dts-conflict-review", refusalSink: createTrustedRefusalAuditSink(db) })).status).toBe("approved");
    const current = (await db.query<{ storage_key: string }>(`select version.storage_key
      from project_parameter_files file join project_parameter_file_versions version on version.id=file.current_version_id
      where file.id=$1`, [uploaded.file.id])).rows[0]!;
    const applied = (await storage.get(current.storage_key)).toString();
    expect(applied).toContain("iin_max = <50>");
    expect(applied).toContain("iin_max = <36>");
    expect(applied).not.toContain("iin_max = <60>");
    const after = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: DTS_PROJECT });
    expect(after.values.length).toBe(before.values.length + 2);
    expect(after.pins.length).toBe(before.pins.length + 2);
    expect(after.history.length).toBe(before.history.length + 2);
  }, 120_000);
});
