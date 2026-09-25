import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { createLocalObjectStore } from "../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { captureConfigurationSourceState, installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { loadProjectValueById } from "../parameter-bindings/values/repositories";
import { asValueClient } from "../parameter-bindings/catalogProjectValueSync";
import { createCandidate } from "./candidateService";
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

describe("#906 selected canonical file/UI conflict source transaction", () => {
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
    await f.db.query("update project_parameter_file_candidates set impact=impact-'canonicalSourceWorkflow' where id=$1", [f.candidate.id]);
    const lostLink = await state(f);
    await expect(approve(f, pending.requestId)).rejects.toMatchObject({
      code: "CONFLICT", details: { reason: "conflict-decision-stale" }
    });
    expect(await state(f)).toEqual(lostLink);
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
