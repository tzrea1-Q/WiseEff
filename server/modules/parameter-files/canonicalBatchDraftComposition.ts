import { createHash } from "node:crypto";

import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { ObjectStore } from "../logs/objectStore";
import { parseDtsValue } from "../dts";
import { ensureOverlayProperty } from "../parameter-topology/overlayWriteback";
import { serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";
import type {
  CanonicalBatchDraftCompositionPrepareInput,
  CanonicalBatchDraftCompositionProof
} from "../parameter-bindings/drafts/batchChangeService";
import {
  loadCanonicalSourceSnapshot, loadPinnedDtsProperty
} from "./canonicalSource";
import {
  freezeCanonicalCandidateBatchSnapshotInTransaction,
  prepareCanonicalCandidateBatchInTransaction,
  prepareCanonicalConflictDecision,
  previewCanonicalCandidateInTransaction,
  recheckCanonicalCandidateBatchForReviewInTransaction,
  recheckCanonicalConflictDecisionForReviewInTransaction,
  type CanonicalSourceBatchPrepareDto
} from "./canonicalFileWorkflow";
import { getParameterFileCandidateByIdForUpdate } from "./candidateRepository";
import { createCandidateInTransaction } from "./candidateService";
import { deleteJsonSourceMember, MAX_PARAMETER_SOURCE_BYTES, parseJsonSource, patchJsonSource } from "./jsonSource";
import type { ProjectParameterFileCandidateDto } from "./types";

type SourceFacts = Omit<CanonicalBatchDraftCompositionProof, "decisionProofDigest">;
type Decision = SourceFacts["targetDecisions"][number];
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const same = (left: unknown, right: unknown) =>
  serializeContract(left as ContractJsonValue) === serializeContract(right as ContractJsonValue);
function fail(reason: string): never {
  throw new ApiError("CONFLICT", "Canonical batch composition source proof is stale.", { reason });
}

async function candidateObject(
  tx: Database, store: ObjectStore, auth: AuthContext, projectId: string, candidateId: string
): Promise<{ candidate: ProjectParameterFileCandidateDto; bytes: Buffer; object: SourceFacts["uploadObject"] }> {
  const candidate = await getParameterFileCandidateByIdForUpdate(tx, {
    organizationId: auth.organization.id, projectId, candidateId
  });
  if (!candidate?.storageKey || candidate.status !== "ready" || !candidate.checksum
    || !Number.isSafeInteger(candidate.sizeBytes) || candidate.sizeBytes! < 0
    || candidate.sizeBytes! > MAX_PARAMETER_SOURCE_BYTES || !store.getBounded) {
    fail("canonical-batch-candidate-stale");
  }
  const bytes = await store.getBounded(candidate.storageKey, MAX_PARAMETER_SOURCE_BYTES);
  const digest = sha256(bytes);
  if (bytes.length !== candidate.sizeBytes || digest !== candidate.checksum.replace(/^sha256:/, "")) {
    fail("canonical-batch-object-drift");
  }
  return { candidate, bytes, object: {
    storageKey: candidate.storageKey, sha256: digest, sizeBytes: bytes.length, proofToken: ""
  } };
}

async function selectedDraft(
  tx: Database, store: ObjectStore, auth: AuthContext,
  input: { projectId: string; uploadCandidateId: string; bindingId: string; draftId: string },
  cohort: CanonicalSourceBatchPrepareDto["cohort"], reviewer = false
): Promise<{ decision: Decision["draft"]; action: Decision["action"]; targetText: string | null; targetValue: ContractJsonValue }> {
  const row = (await tx.query<{ snapshot: Record<string, unknown> }>(`
    select to_jsonb(draft) as snapshot from public.project_parameter_value_drafts draft
     where draft.id=$1 and draft.organization_id=$2 and draft.project_id=$3
       and draft.binding_id=$4 for update`,
    [input.draftId, auth.organization.id, input.projectId, input.bindingId])).rows[0]?.snapshot;
  const member = cohort.find((entry) => entry.bindingId === input.bindingId);
  if (!row || !member || typeof row.candidate_id !== "string"
    || row.base_current_value_id !== member.oldValueId
    || row.source_pin_id !== member.sourcePinId || row.action !== "set" && row.action !== "delete") {
    fail("selected-draft-stale");
  }
  const chosen = await (reviewer
    ? recheckCanonicalConflictDecisionForReviewInTransaction
    : prepareCanonicalConflictDecision)(tx, store, auth, {
    projectId: input.projectId, candidateId: input.uploadCandidateId,
    selectedBindingId: input.bindingId, selectedDraftId: input.draftId, choice: "draft"
  });
  if (chosen.selectedBaseValueId !== member.oldValueId
    || chosen.selectedSourcePinId !== member.sourcePinId
    || chosen.selectedRevisionId !== row.config_revision_id) fail("selected-draft-stale");
  const artifact = await candidateObject(tx, store, auth, input.projectId, row.candidate_id);
  if (artifact.object.sha256 !== chosen.selectedDraftCandidateDigest.replace(/^sha256:/, "")) {
    fail("selected-draft-object-drift");
  }
  const fingerprint = sha256(serializeContract(row as ContractJsonValue));
  return {
    decision: {
      id: input.draftId,
      authorUserId: row.user_id === null ? null : String(row.user_id),
      frozenFingerprint: fingerprint,
      baseCurrentValueId: member.oldValueId,
      sourcePinId: member.sourcePinId,
      configRevisionId: String(row.config_revision_id),
      candidateStorageKey: artifact.object.storageKey,
      candidateSha256: artifact.object.sha256,
      candidateSizeBytes: artifact.object.sizeBytes
    },
    action: row.action,
    targetText: chosen.targetText ?? null,
    targetValue: row.target_value as ContractJsonValue
  };
}

async function renderSource(
  tx: Database, store: ObjectStore, auth: AuthContext,
  proof: CanonicalSourceBatchPrepareDto, decisions: readonly Pick<Decision, "bindingId" | "action" | "targetText">[]
): Promise<Buffer> {
  const first = proof.cohort[0];
  if (!first) fail("canonical-batch-cohort-stale");
  const source = await loadCanonicalSourceSnapshot(tx, store, {
    organizationId: auth.organization.id, projectId: proof.projectId,
    bindingId: first.bindingId, projectValueId: first.oldValueId
  });
  const index = source.manifest.members.findIndex((member) =>
    member.fileId === proof.fileId && member.fileVersionId === proof.baseVersionId);
  if (index < 0 || source.manifest.configSetId !== proof.configSetId) fail("canonical-batch-source-stale");
  const base = source.files[index]!.content;
  if (sha256(base) !== proof.baseDigest) fail("canonical-batch-source-stale");
  if (proof.format === "json") {
    let bytes: Buffer = Buffer.from(base);
    for (const decision of decisions) {
      const member = proof.cohort.find((entry) => entry.bindingId === decision.bindingId);
      if (!member || member.locator.kind !== "json-pointer" || typeof member.locator.pointer !== "string") {
        fail("canonical-batch-locator-stale");
      }
      const pinned = await loadCanonicalSourceSnapshot(tx, store, {
        organizationId: auth.organization.id, projectId: proof.projectId,
        bindingId: member.bindingId, projectValueId: member.oldValueId
      });
      if (pinned.manifest.rootPointer === null) fail("canonical-batch-locator-stale");
      bytes = decision.action === "delete"
        ? deleteJsonSourceMember(bytes, member.locator.pointer, pinned.manifest.rootPointer).bytes
        : patchJsonSource(bytes, member.locator.pointer, decision.targetText!, pinned.manifest.rootPointer);
    }
    return bytes;
  }
  const edits: Array<{ decision: typeof decisions[number]; row: Awaited<ReturnType<typeof loadPinnedDtsProperty>> }> = [];
  for (const decision of decisions) {
    const member = proof.cohort.find((entry) => entry.bindingId === decision.bindingId);
    if (!member) fail("canonical-batch-cohort-stale");
    const pinned = await loadCanonicalSourceSnapshot(tx, store, {
      organizationId: auth.organization.id, projectId: proof.projectId,
      bindingId: member.bindingId, projectValueId: member.oldValueId
    });
    if (pinned.manifest.fileId !== proof.fileId || pinned.manifest.fileVersionId !== proof.baseVersionId) {
      fail("canonical-batch-source-stale");
    }
    const row = await loadPinnedDtsProperty(tx, pinned.manifest);
    edits.push({ decision, row });
  }
  edits.sort((left, right) => right.row.start_offset - left.row.start_offset);
  if (new Set(edits.map((edit) => edit.row.start_offset)).size !== edits.length) fail("canonical-batch-locator-stale");
  let text = base;
  for (const { decision, row } of edits) {
    text = ensureOverlayProperty(text, {
      propertyKey: row.property_name, rawText: decision.targetText,
      action: decision.action, targetRef: row.node_locator,
      expectedChecksum: sha256(text),
      occurrenceSpan: { start: row.start_offset, end: row.end_offset },
      expectedRawText: row.raw_text
    });
  }
  return Buffer.from(text);
}

function targetValue(proof: CanonicalSourceBatchPrepareDto, ordinal: number): ContractJsonValue {
  const target = proof.targets[ordinal];
  if (!target) fail("canonical-batch-target-order-stale");
  if (target.action === "delete") return "";
  if (!target.targetText) fail("canonical-batch-target-text-stale");
  if (proof.format === "json") return { kind: "json-source", value: parseJsonSource(target.targetText) as ContractJsonValue };
  if (target.locator.kind !== "dts-property" || typeof target.locator.propertyName !== "string") {
    fail("canonical-batch-locator-stale");
  }
  return parseDtsValue(target.locator.propertyName, target.targetText).value as ContractJsonValue;
}

function assertMatchingProof(upload: CanonicalSourceBatchPrepareDto,
  composed: CanonicalSourceBatchPrepareDto, decisions: readonly Decision[]) {
  if (composed.fileId !== upload.fileId || composed.baseVersionId !== upload.baseVersionId
    || composed.configSetId !== upload.configSetId || composed.format !== upload.format
    || composed.cohortProofToken !== upload.cohortProofToken
    || !same(composed.members, upload.members) || !same(composed.cohort, upload.cohort)
    || composed.targets.length !== decisions.length
    || composed.targets.some((target, ordinal) => target.bindingId !== decisions[ordinal]?.bindingId
      || target.action !== decisions[ordinal]?.action
      || (target.targetText ?? null) !== decisions[ordinal]?.targetText
      || !same(target.locator, decisions[ordinal]?.locator)
      || !same(targetValue(composed, ordinal), decisions[ordinal]?.targetValue))) {
    fail("canonical-batch-composition-mismatch");
  }
}

/** Caller holds the outer attempt transaction; D does not own COMMIT or object cleanup. */
export async function prepareCanonicalBatchDraftCompositionInTransaction(
  tx: Database, objectStore: ObjectStore, auth: AuthContext,
  input: CanonicalBatchDraftCompositionPrepareInput
): Promise<{ candidate: CanonicalSourceBatchPrepareDto; compositionProof: SourceFacts }> {
  if (!input.requestId.trim() || !/^[0-9a-f]{64}$/.test(input.draftImpactDigest)) {
    throw new ApiError("VALIDATION_FAILED", "A frozen draft impact digest and request identity are required.");
  }
  const upload = await freezeCanonicalCandidateBatchSnapshotInTransaction(tx, objectStore, auth, {
    projectId: input.projectId, candidateId: input.uploadCandidateId,
    expectedProofToken: input.expectedUploadProofToken
  });
  if (input.targetDecisions.length !== upload.targets.length
    || input.targetDecisions.some((decision, ordinal) =>
      decision.bindingId !== upload.targets[ordinal]?.bindingId
      || (decision.choice !== "file" && decision.choice !== "draft")
      || (decision.choice === "draft" ? !decision.draftId?.trim() : decision.draftId !== undefined))
    || !input.targetDecisions.some((decision) => decision.choice === "draft")) {
    fail("canonical-batch-target-decision-required");
  }
  const prior = await tx.query<{ target_id: string }>(`
    select target_id from public.audit_events
     where organization_id=$1 and project_id=$2 and trace_id=$3
       and target_type='project-parameter-file-candidate' and action='create'
     limit 1`, [auth.organization.id, input.projectId, input.requestId]);
  if (prior.rows.length) fail("canonical-batch-composition-request-replayed");
  const original = await candidateObject(tx, objectStore, auth, input.projectId, input.uploadCandidateId);
  if (original.object.sha256 !== upload.proposedDigest) fail("canonical-batch-upload-object-drift");
  const choices: Decision[] = [];
  for (const [ordinal, target] of upload.targets.entries()) {
    const choice = input.targetDecisions[ordinal]!;
    const draft = choice.choice === "draft" ? await selectedDraft(tx, objectStore, auth, {
      projectId: input.projectId, uploadCandidateId: input.uploadCandidateId,
      bindingId: target.bindingId, draftId: choice.draftId!
    }, upload.cohort) : null;
    const value = draft ? draft.targetValue : targetValue(upload, ordinal);
    const text = draft ? draft.targetText : target.targetText ?? null;
    if (draft && !same(value, draft.action === "delete" ? "" : upload.format === "json"
      ? { kind: "json-source", value: parseJsonSource(text!) } : parseDtsValue(
        String((target.locator as { propertyName?: string }).propertyName), text!).value)) {
      fail("selected-draft-value-stale");
    }
    choices.push({ ordinal, bindingId: target.bindingId, choice: choice.choice,
      action: draft?.action ?? target.action, locator: target.locator,
      targetValue: value, targetText: text, draft: draft?.decision ?? null });
  }
  const fileOnly = await renderSource(tx, objectStore, auth, upload, upload.targets.map((target) => ({
    bindingId: target.bindingId, action: target.action, targetText: target.targetText ?? null
  })));
  if (!fileOnly.equals(original.bytes)) fail("canonical-batch-upload-bytes-stale");
  const composedBytes = await renderSource(tx, objectStore, auth, upload, choices);
  const composedCandidate = await createCandidateInTransaction(tx, objectStore, auth, {
    projectId: input.projectId, fileId: upload.fileId, fileName: original.candidate.fileName,
    bytes: composedBytes
  }, { invocation: createUserInvocation(auth), requestId: input.requestId });
  if (composedCandidate.status !== "ready") fail("canonical-batch-composed-candidate-blocked");
  const preview = await previewCanonicalCandidateInTransaction(tx, objectStore, auth, {
    projectId: input.projectId, candidateId: composedCandidate.id
  });
  if (!preview.proofToken) fail("canonical-batch-composed-proof-missing");
  const candidate = await freezeCanonicalCandidateBatchSnapshotInTransaction(tx, objectStore, auth, {
    projectId: input.projectId, candidateId: composedCandidate.id,
    expectedProofToken: preview.proofToken
  });
  assertMatchingProof(upload, candidate, choices);
  const stored = await candidateObject(tx, objectStore, auth, input.projectId, candidate.candidateId);
  if (!stored.bytes.equals(composedBytes)) fail("canonical-batch-composed-object-drift");
  return { candidate, compositionProof: {
    kind: "canonical-batch-draft-composition", organizationId: auth.organization.id,
    projectId: input.projectId, format: upload.format, fileId: upload.fileId,
    baseVersionId: upload.baseVersionId, configSetId: upload.configSetId,
    cohortProofToken: upload.cohortProofToken,
    uploadCandidateId: upload.candidateId, composedCandidateId: candidate.candidateId,
    uploadObject: { ...original.object, proofToken: upload.proofToken },
    composedObject: { ...stored.object, proofToken: candidate.proofToken },
    batchProofDigest: candidate.batchProofDigest, draftImpactDigest: input.draftImpactDigest,
    members: candidate.members, cohort: candidate.cohort, targetDecisions: choices
  } };
}

/** D source recheck under the same locks; C owns the decision digest and impact comparison. */
export async function recheckCanonicalBatchDraftCompositionForReviewInTransaction(
  tx: Database, objectStore: ObjectStore, auth: AuthContext,
  input: { projectId: string; compositionProof: CanonicalBatchDraftCompositionProof }
): Promise<CanonicalSourceBatchPrepareDto> {
  const frozen = input.compositionProof;
  if (frozen.organizationId !== auth.organization.id || frozen.projectId !== input.projectId
    || !/^[0-9a-f]{64}$/.test(frozen.draftImpactDigest)
    || !frozen.targetDecisions.some((decision) => decision.choice === "draft")) {
    fail("canonical-batch-proof-mismatch");
  }
  const upload = await recheckCanonicalCandidateBatchForReviewInTransaction(tx, objectStore, auth, {
    projectId: input.projectId, candidateId: frozen.uploadCandidateId,
    expectedProofToken: frozen.uploadObject.proofToken
  });
  const composed = await recheckCanonicalCandidateBatchForReviewInTransaction(tx, objectStore, auth, {
    projectId: input.projectId, candidateId: frozen.composedCandidateId,
    expectedProofToken: frozen.composedObject.proofToken
  });
  const original = await candidateObject(tx, objectStore, auth, input.projectId, frozen.uploadCandidateId);
  const result = await candidateObject(tx, objectStore, auth, input.projectId, frozen.composedCandidateId);
  if (!same({ ...original.object, proofToken: upload.proofToken }, frozen.uploadObject)
    || !same({ ...result.object, proofToken: composed.proofToken }, frozen.composedObject)
    || frozen.batchProofDigest !== composed.batchProofDigest
    || frozen.uploadCandidateId !== upload.candidateId
    || frozen.composedCandidateId !== composed.candidateId
    || frozen.format !== upload.format || composed.format !== upload.format
    || frozen.fileId !== upload.fileId || frozen.baseVersionId !== upload.baseVersionId
    || frozen.configSetId !== upload.configSetId || frozen.cohortProofToken !== upload.cohortProofToken
    || !same(frozen.members, upload.members) || !same(frozen.cohort, upload.cohort)
    || !same(composed.members, upload.members) || !same(composed.cohort, upload.cohort)
    || frozen.targetDecisions.length !== upload.targets.length) fail("canonical-batch-proof-mismatch");
  const checked: Decision[] = [];
  for (const [ordinal, target] of upload.targets.entries()) {
    const decision = frozen.targetDecisions[ordinal];
    if (!decision || decision.ordinal !== ordinal || decision.bindingId !== target.bindingId
      || (decision.choice === "draft" && !decision.draft)) {
      fail("canonical-batch-target-order-stale");
    }
    const draft = decision.choice === "draft" && decision.draft ? await selectedDraft(tx, objectStore, auth, {
      projectId: input.projectId, uploadCandidateId: upload.candidateId,
      bindingId: target.bindingId, draftId: decision.draft.id
    }, upload.cohort, true) : null;
    const expected: Decision = { ordinal, bindingId: target.bindingId,
      choice: decision.choice, action: draft?.action ?? target.action,
      locator: target.locator, targetText: draft ? draft.targetText : target.targetText ?? null,
      targetValue: draft ? draft.targetValue : targetValue(upload, ordinal), draft: draft?.decision ?? null };
    if (!same(expected, decision)) fail("canonical-batch-decision-stale");
    checked.push(expected);
  }
  const fileOnly = await renderSource(tx, objectStore, auth, upload, upload.targets.map((target) => ({
    bindingId: target.bindingId, action: target.action, targetText: target.targetText ?? null
  })));
  const composedBytes = await renderSource(tx, objectStore, auth, upload, checked);
  if (!fileOnly.equals(original.bytes) || !composedBytes.equals(result.bytes)) {
    fail("canonical-batch-object-drift");
  }
  assertMatchingProof(upload, composed, checked);
  return composed;
}
