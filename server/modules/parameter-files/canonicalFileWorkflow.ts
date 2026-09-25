import { createHash } from "node:crypto";

import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { asAuditTx } from "../audit/auditedWrite";
import { writeTrustedGovernanceAudit } from "../parameter-topology/governanceAudit";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import { canAdminParameters, canEditParameters, canReviewParameters, canReviewParameterStage } from "../parameter-kernel/policy";
import { hasCurrentCanonicalReviewRole } from "../parameters/reviewWorkflowRepository";
import type { DtsValue } from "../dts/types";
import { renderDtsValue } from "../dts/valueAst";
import {
  createCanonicalValueDraft,
  type CanonicalValueDraftDto
} from "../parameter-bindings/drafts/service";
import type { CanonicalChangeRequestStatus, CanonicalValueChangeRequestRow } from "../parameter-bindings/drafts/changeRepository";
import { getCanonicalValueChangeRequest } from "../parameter-bindings/drafts/changeRepository";
import { loadSourceBindingCohortReadOnly, loadOwnedProjectValueSourcePin, discoverDeletedSourceRevisionPins } from "../parameter-bindings/values";
import type { CanonicalSourceBindingPin, CanonicalValueSourcePin } from "../parameter-bindings/values";
import {
  canonicalSourceMemberMatchesCurrentFile,
  type CanonicalSourceCurrentMember,
  loadCanonicalSourceCohort,
  loadCanonicalSourceSnapshot,
  loadPinnedDtsProperty,
  readPinnedDtsSourceBatchChanges,
  readPinnedDtsSourceChange,
  lockCanonicalSourceCohort,
  validatePinnedDtsSourceDeletion
} from "./canonicalSource";
import { loadExactSourceRevisionForProof, rethrowSourceTransactionError } from "./sourceVersion";
import { withCanonicalSourceAttemptTransaction } from "./canonicalSourceAttemptTransaction";
import type { CanonicalSourceAttempt } from "./canonicalSourceAttempt";
import {
  deleteJsonSourceMember,
  MAX_PARAMETER_SOURCE_BYTES,
  parseJsonSource,
  patchJsonSource,
  readJsonSourceText
} from "./jsonSource";
import { ensureOverlayProperty } from "../parameter-topology/overlayWriteback";
import {
  getParameterFileCandidateById,
  getParameterFileCandidateByIdForUpdate,
  linkParameterFileCandidateToCanonicalWorkflow,
  listParameterFileCandidates
} from "./candidateRepository";
import {
  getFileVersionById,
  getProjectParameterFileById,
  getProjectParameterFileConfigSetId
} from "./repository";
import { createCandidate } from "./candidateService";
import { lockUserById } from "../users/repository";
import type { ParameterFileFormat, ProjectParameterFileCandidateDto } from "./types";

export type CanonicalSourceWorkflowDto = {
  canonical: boolean;
  configSetId?: string;
  reason?: string;
  bindingCount: number;
  proofToken?: string;
};

export type CanonicalSourcePreviewBindingDto = {
  bindingId: string;
  definitionId: string;
  baseCurrentValueId: string;
  configRevisionId: string;
  sourcePinId: string;
  locator: string;
  baseDigest: string;
  proposedDigest: string;
  action: SourceAction;
  beforeText: string;
  afterText?: string;
};

export type CanonicalSourcePreviewDto = {
  kind: "legacy" | "canonical";
  canSubmit: boolean;
  reason?: string;
  candidateId: string;
  fileId?: string;
  format: ParameterFileFormat;
  baseVersionId?: string;
  configSetId?: string;
  cohortProofToken?: string;
  bindingId?: string;
  definitionId?: string;
  baseCurrentValueId?: string;
  configRevisionId?: string;
  sourcePinId?: string;
  locator?: string;
  baseDigest?: string;
  proposedDigest?: string;
  proofToken?: string;
  before?: string;
  after?: string;
  bindings?: CanonicalSourcePreviewBindingDto[];
  request?: { id: string; status: CanonicalChangeRequestStatus };
};

export type CanonicalSourceBatchMemberDto = Readonly<{
  memberId: string;
  fileId: string;
  fileVersionId: string;
  sourceName: string;
  format: ParameterFileFormat;
  role: string;
  sortOrder: number;
  checksum: string;
  sizeBytes: number;
  configSetId: string;
  isCandidateFile: boolean;
}>;

export type CanonicalSourceBatchCohortDto = Readonly<{
  bindingId: string;
  oldValueId: string;
  sourcePinId: string;
  sourceOccurrenceId: string;
  definitionId: string;
  effectiveRevisionId: string;
  catalogReleaseId: string;
  locator: CanonicalSourceBindingPin["locator"];
  valueKind: string;
  valueDigest: string;
  configSetId: string;
}>;

export type CanonicalSourceBatchTargetDto = Readonly<{
  bindingId: string;
  definitionId: string;
  baseCurrentValueId: string;
  configRevisionId: string;
  sourcePinId: string;
  locator: CanonicalSourceBindingPin["locator"];
  baseDigest: string;
  proposedDigest: string;
  action: SourceAction;
  beforeText: string;
  afterText?: string;
  targetText?: string;
}>;

/** Read-only proof frozen for a future single-request batch owner. */
export type CanonicalSourceBatchPrepareDto = Readonly<{
  kind: "canonical-source-batch";
  organizationId: string;
  projectId: string;
  candidateId: string;
  fileId: string;
  format: "json" | "dts";
  baseVersionId: string;
  configSetId: string;
  baseDigest: string;
  proposedDigest: string;
  cohortProofToken: string;
  /** Existing candidate-specific proof token; its single-target meaning is unchanged. */
  proofToken: string;
  batchProofDigest: string;
  members: readonly CanonicalSourceBatchMemberDto[];
  cohort: readonly CanonicalSourceBatchCohortDto[];
  targets: readonly CanonicalSourceBatchTargetDto[];
}>;

export type CanonicalSourceSubmitDto = {
  requestId: string;
  status: CanonicalChangeRequestStatus;
  replayed: boolean;
};

type SourceAction = "set" | "delete";

type SourceChange = {
  candidate: ProjectParameterFileCandidateDto;
  fileId: string;
  format: ParameterFileFormat;
  configSetId: string;
  binding: CanonicalSourceBindingPin;
  pin: CanonicalValueSourcePin;
  action: SourceAction;
  beforeTargetText: string;
  targetText?: string;
  targetValue?: DtsValue;
  baseText: string;
  candidateText: string;
  baseBytes: Buffer;
  candidateBytes: Buffer;
  baseDigest: string;
  proposedDigest: string;
  fingerprint: string;
};

type SourceInspection = {
  workflow: CanonicalSourceWorkflowDto;
  candidate: ProjectParameterFileCandidateDto;
  change?: SourceChange;
  changes?: SourceChange[];
  proofToken?: string;
  reason?: string;
};

type RequestStatus = { id: string; status: CanonicalChangeRequestStatus };
type RequestRecord = Pick<CanonicalValueChangeRequestRow, "id" | "status" | "candidate_id" | "draft_id">;

function digest(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableProofValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableProofValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableProofValue(item)]));
  }
  return value;
}

function proofDigest(input: unknown) {
  return createHash("sha256").update(JSON.stringify(stableProofValue(input))).digest("hex");
}

async function buildWorkflowProofToken(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string;
    fileId: string;
    currentVersionId: string | null;
    configSetId: string;
    bindings: CanonicalSourceBindingPin[];
    deleted: Array<{ configRevisionId: string; fileId: string; fileVersionId: string }>;
  }
) {
  const pins = await Promise.all(input.bindings.map(async (binding) => {
    if (!binding.sourcePinId || !binding.oldValueId) return null;
    const pin = await loadOwnedProjectValueSourcePin(db, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      bindingId: binding.bindingId,
      projectValueId: binding.oldValueId
    });
    return pin ? {
      bindingId: binding.bindingId,
      oldValueId: binding.oldValueId,
      sourcePinId: pin.sourcePinId,
      sourceOccurrenceId: pin.sourceOccurrenceId,
      configRevisionId: pin.configRevisionId,
      fileId: pin.fileId,
      fileVersionId: pin.fileVersionId,
      format: pin.format,
      locator: pin.locator,
      rootPointer: pin.rootPointer,
      valueDigest: binding.valueDigest
    } : null;
  }));
  return proofDigest({
    fileId: input.fileId,
    currentVersionId: input.currentVersionId,
    configSetId: input.configSetId,
    bindings: input.bindings.map((binding) => ({
      bindingId: binding.bindingId,
      oldValueId: binding.oldValueId,
      sourcePinId: binding.sourcePinId,
      sourceOccurrenceId: binding.sourceOccurrenceId,
      definitionId: binding.definitionId,
      valueDigest: binding.valueDigest,
      configSetId: binding.configSetId
    })),
    pins: pins.filter((pin): pin is NonNullable<typeof pin> => pin !== null).sort((a, b) => a.bindingId.localeCompare(b.bindingId)),
    deleted: [...input.deleted].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  });
}

function candidateProofToken(workflowToken: string, candidate: ProjectParameterFileCandidateDto, candidateDigest: string) {
  return proofDigest({ workflowToken, candidateId: candidate.id, baseVersionId: candidate.baseVersionId, candidateDigest });
}

function fingerprint(input: Omit<SourceChange, "fingerprint" | "candidate" | "baseBytes" | "candidateBytes" | "baseText" | "candidateText" | "targetText" | "targetValue">) {
  return createHash("sha256")
    .update(JSON.stringify({
      projectId: input.pin.projectId,
      fileId: input.fileId,
      bindingId: input.binding.bindingId,
      sourcePinId: input.pin.sourcePinId,
      baseVersionId: input.pin.fileVersionId,
      configRevisionId: input.pin.configRevisionId,
      baseDigest: input.baseDigest,
      proposedDigest: input.proposedDigest,
      action: input.action
    }))
    .digest("hex");
}

function sourceLocator(pin: CanonicalValueSourcePin) {
  return JSON.stringify(pin.locator);
}

function decodeUtf8(bytes: Buffer, label: string) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ApiError("CONFLICT", `${label} is not valid UTF-8.`, { reason: "invalid-source-encoding" });
  }
}

async function getBoundedObject(objectStore: ObjectStore, storageKey: string) {
  const bytes = objectStore.getBounded
    ? await objectStore.getBounded(storageKey, MAX_PARAMETER_SOURCE_BYTES)
    : await objectStore.get(storageKey);
  if (bytes.length > MAX_PARAMETER_SOURCE_BYTES) {
    throw new ApiError("CONFLICT", "Canonical source exceeds the bounded proof size.", {
      reason: "source-proof-limit"
    });
  }
  return bytes;
}

function exactCandidateObjectStore(objectStore: ObjectStore, expected: Buffer): ObjectStore {
  const store: ObjectStore = {
    async put(input): Promise<StoredObject> {
      if (!input.bytes.equals(expected)) {
        throw new ApiError("CONFLICT", "Candidate bytes differ from the canonical prepared source.", {
          reason: "candidate-bytes-not-preserved"
        });
      }
      return objectStore.put(input);
    },
    get: (storageKey) => objectStore.get(storageKey)
  };
  if (objectStore.getBounded) store.getBounded = (storageKey, maxBytes) => objectStore.getBounded!(storageKey, maxBytes);
  if (objectStore.delete) store.delete = (storageKey) => objectStore.delete!(storageKey);
  return store;
}

async function loadRequestForCandidate(
  db: Queryable,
  input: { organizationId: string; projectId: string; candidateId: string }
): Promise<RequestRecord | null> {
  const result = await db.query<{ id: string }>(
    `select id
       from project_parameter_value_change_requests
      where organization_id = $1 and project_id = $2 and candidate_id = $3
      order by created_at desc, id desc
      limit 1`,
    [input.organizationId, input.projectId, input.candidateId]
  );
  const id = result.rows[0]?.id;
  return id
    ? getCanonicalValueChangeRequest(db, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        requestId: id
      })
    : null;
}

async function loadRequestForWorkflowLink(
  db: Queryable,
  auth: AuthContext,
  candidate: ProjectParameterFileCandidateDto
) {
  const linked = candidate.impact?.canonicalSourceWorkflow?.requestId;
  if (!linked) return null;
  return getCanonicalValueChangeRequest(db, {
    organizationId: auth.organization.id,
    projectId: candidate.projectId,
    requestId: linked
  });
}

async function fileWorkflow(
  db: Queryable,
  auth: AuthContext,
  input: { projectId: string; fileId: string }
): Promise<CanonicalSourceWorkflowDto> {
  const file = await getProjectParameterFileById(db, {
    organizationId: auth.organization.id,
    fileId: input.fileId
  });
  if (!file || file.projectId !== input.projectId) {
    throw new ApiError("NOT_FOUND", "Project parameter file was not found.", input);
  }
  const configSetId = await getProjectParameterFileConfigSetId(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    fileId: input.fileId
  });
  if (!configSetId) return { canonical: false, bindingCount: 0 };

  const bindings = await loadSourceBindingCohortReadOnly(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    configSetId
  });
  const bindingCount = bindings.filter((binding) => binding.sourcePinId).length;
  const deleted = await discoverDeletedSourceRevisionPins(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    configSetId
  });
  if (bindingCount > 0 || deleted.length > 0) {
    return {
      canonical: true,
      configSetId,
      bindingCount,
      proofToken: await buildWorkflowProofToken(db, auth, {
        projectId: input.projectId,
        fileId: input.fileId,
        currentVersionId: file.currentVersionId ?? null,
        configSetId,
        bindings,
        deleted
      })
    };
  }
  return { canonical: false, configSetId, bindingCount: 0 };
}

async function inspectCandidate(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; candidateId: string }
): Promise<SourceInspection> {
  const candidate = await getParameterFileCandidateById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    candidateId: input.candidateId
  });
  if (!candidate) {
    throw new ApiError("NOT_FOUND", "Candidate file version was not found.", input);
  }
  if (!candidate.fileId || !candidate.baseVersionId || !candidate.storageKey) {
    return { workflow: { canonical: false, bindingCount: 0 }, candidate, reason: "candidate-has-no-existing-file-base" };
  }
  if (!["ready", "blocked", "stale"].includes(candidate.status)) {
    return { workflow: { canonical: false, bindingCount: 0 }, candidate, reason: "candidate-is-not-reviewable" };
  }

  const workflow = await fileWorkflow(db, auth, { projectId: input.projectId, fileId: candidate.fileId });
  if (!workflow.canonical || !workflow.configSetId) {
    return { workflow, candidate, reason: "file-is-not-canonical" };
  }
  const file = await getProjectParameterFileById(db, {
    organizationId: auth.organization.id,
    fileId: candidate.fileId
  });
  if (!file || file.projectId !== input.projectId || file.currentVersionId !== candidate.baseVersionId) {
    return { workflow, candidate, reason: "candidate-base-is-stale" };
  }
  if (candidate.format !== "dts" && candidate.format !== "json") {
    return { workflow, candidate, reason: "unsupported-source-format" };
  }

  let candidateBytes: Buffer;
  try {
    candidateBytes = await getBoundedObject(objectStore, candidate.storageKey);
  } catch (error) {
    if (error instanceof ApiError) return { workflow, candidate, reason: "candidate-content-unavailable" };
    throw error;
  }
  const candidateText = decodeUtf8(candidateBytes, "Candidate source");
  const candidateDigest = digest(candidateBytes);
  if (candidate.checksum && candidate.checksum !== candidateDigest) {
    return { workflow, candidate, reason: "candidate-storage-digest-mismatch" };
  }
  if (candidate.sizeBytes !== undefined && candidate.sizeBytes !== candidateBytes.length) {
    return { workflow, candidate, reason: "candidate-storage-size-mismatch" };
  }
  if (candidate.format === "json") {
    try {
      parseJsonSource(candidateBytes);
    } catch {
      return { workflow, candidate, reason: "candidate-json-invalid" };
    }
  }

  const bindings = await loadSourceBindingCohortReadOnly(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    configSetId: workflow.configSetId
  });
  const matches: Array<{ binding: CanonicalSourceBindingPin; pin: CanonicalValueSourcePin; source: Awaited<ReturnType<typeof loadCanonicalSourceSnapshot>> }> = [];
  for (const binding of bindings) {
    if (!binding.sourcePinId || !binding.oldValueId || binding.configSetId !== workflow.configSetId) continue;
    const pin = await loadOwnedProjectValueSourcePin(db, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      bindingId: binding.bindingId,
      projectValueId: binding.oldValueId
    });
    if (!pin || pin.fileId !== candidate.fileId || pin.fileVersionId !== candidate.baseVersionId) continue;
    if (!pin.configRevisionId.trim()) {
      return { workflow, candidate, reason: "source-config-revision-required" };
    }
    if (pin.format !== candidate.format) {
      return { workflow, candidate, reason: "candidate-format-does-not-match-source-pin" };
    }
    const source = await loadCanonicalSourceSnapshot(db, objectStore, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      bindingId: binding.bindingId,
      projectValueId: binding.oldValueId
    });
    const currentMembers = await db.query<CanonicalSourceCurrentMember>(
      `select id,current_version_id,config_set_role,config_set_sort_order,format
         from project_parameter_files where config_set_id=$1 order by id`,
      [workflow.configSetId]
    );
    if (currentMembers.rows.length !== source.manifest.members.length || currentMembers.rows.some((member) =>
      !source.manifest.members.some((pinned) => canonicalSourceMemberMatchesCurrentFile(pinned, member)))) {
      return { workflow, candidate, reason: "source-membership-drift" };
    }
    matches.push({ binding, pin, source });
  }
  if (!matches.length) {
    return { workflow, candidate, reason: "candidate-base-is-not-a-pinned-source" };
  }

  const changes: SourceChange[] = [];
  const jsonPatchPlans: Array<{ baseBytes: Buffer; pointer: string; rootPointer: string; action: SourceAction; targetText?: string }> = [];
  let jsonBaseBytes: Buffer | undefined;
  let dtsRenderProofFailed = false;
  let dtsBatchChanges: Awaited<ReturnType<typeof readPinnedDtsSourceBatchChanges>> | null = null;
  if (candidate.format === "dts" && matches.length > 1) {
    const first = matches[0]!.source;
    const index = first.manifest.members.findIndex((member) =>
      member.fileId === candidate.fileId && member.fileVersionId === candidate.baseVersionId);
    if (index < 0 || !matches.every((match) =>
      match.source.manifest.configRevisionId === first.manifest.configRevisionId
      && match.source.files[match.source.manifest.members.findIndex((member) =>
        member.fileId === candidate.fileId && member.fileVersionId === candidate.baseVersionId)]?.content === first.files[index]?.content)) {
      return { workflow, candidate, reason: "dts-batch-source-proof-failed" };
    }
    try {
      dtsBatchChanges = await readPinnedDtsSourceBatchChanges(
        db, matches.map((match) => match.source.manifest), first.files[index]!.content, candidateText);
    } catch (error) {
      if (!(error instanceof ApiError || error instanceof SyntaxError)) throw error;
      return { workflow, candidate, reason: "dts-batch-source-proof-failed" };
    }
  }
  for (const match of matches) {
    const sourceIndex = match.source.manifest.members.findIndex((member) =>
      member.fileId === candidate.fileId && member.fileVersionId === candidate.baseVersionId
    );
    if (sourceIndex < 0 || match.source.manifest.format !== candidate.format) continue;
    const baseText = match.source.files[sourceIndex]!.content;
    const baseBytes = Buffer.from(baseText, "utf8");
    if (candidateBytes.equals(baseBytes)) continue;
    try {
      let action: SourceAction;
      let beforeTargetText: string;
      let targetText: string | undefined;
      let targetValue: DtsValue | undefined;
      if (candidate.format === "json") {
        if (match.pin.rootPointer === null || match.pin.locator.kind !== "json-pointer" || typeof match.pin.locator.pointer !== "string") {
          continue;
        }
        const pointer = match.pin.locator.pointer;
        const rootPointer = match.pin.rootPointer;
        jsonBaseBytes ??= baseBytes;
        if (!baseBytes.equals(jsonBaseBytes)) continue;
        let candidateTarget: string | undefined;
        try {
          candidateTarget = readJsonSourceText(candidateBytes, pointer, rootPointer);
        } catch {
          candidateTarget = undefined;
        }
        const baseTarget = readJsonSourceText(baseBytes, pointer, rootPointer);
        beforeTargetText = baseTarget;
        if (candidateTarget === undefined) {
          // Deletion is proved against the complete candidate below; this plan
          // only records the exact pinned locator for the reconstruction.
          action = "delete";
          jsonPatchPlans.push({ baseBytes, pointer, rootPointer, action });
        } else {
          if (candidateTarget === baseTarget) continue;
          targetText = candidateTarget;
          action = "set";
          jsonPatchPlans.push({ baseBytes, pointer, rootPointer, action, targetText });
        }
      } else {
        beforeTargetText = (await loadPinnedDtsProperty(db, match.source.manifest)).raw_text;
        const batchTarget = dtsBatchChanges?.get(match.pin.sourcePinId);
        if (batchTarget) {
          action = batchTarget.action;
          targetText = batchTarget.rawText;
          targetValue = batchTarget.value;
        } else {
          const deletion = (() => {
            try {
              const row = match.pin.locator;
              if (row.kind !== "dts-property" || typeof row.propertyName !== "string") return null;
              return validatePinnedDtsSourceDeletion(db, match.source.manifest, baseText, candidateText)
                .then(() => true);
            } catch {
              return null;
            }
          })();
          let isDeletion = false;
          if (deletion) {
            try {
              await deletion;
              isDeletion = true;
            } catch {
              isDeletion = false;
            }
          }
          if (isDeletion) {
            action = "delete";
          } else {
            const read = await readPinnedDtsSourceChange(db, match.source.manifest, baseText, candidateText);
            const row = await loadPinnedDtsProperty(db, match.source.manifest);
            const ownerRawText = renderDtsValue(read.value);
            const exact = ensureOverlayProperty(baseText, {
              propertyKey: row.property_name,
              rawText: ownerRawText,
              action: "set",
              targetRef: row.node_locator,
              expectedChecksum: match.source.manifest.members[sourceIndex]!.checksum.replace(/^sha256:/, ""),
              occurrenceSpan: { start: row.start_offset, end: row.end_offset }
            });
            if (exact !== candidateText) {
              dtsRenderProofFailed = true;
              continue;
            }
            action = "set";
            targetText = read.rawText;
            targetValue = read.value;
          }
        }
      }
      const baseDigest = digest(baseBytes);
      const proposedDigest = digest(candidateBytes);
      const candidateWithoutFingerprint = {
        fileId: candidate.fileId,
        format: candidate.format,
        configSetId: workflow.configSetId,
        binding: match.binding,
        pin: match.pin,
        action,
        baseDigest,
        proposedDigest
      } as Omit<SourceChange, "fingerprint" | "candidate" | "baseBytes" | "candidateBytes" | "baseText" | "candidateText" | "targetText" | "targetValue">;
      changes.push({
        candidate,
        fileId: candidate.fileId,
        format: candidate.format,
        configSetId: workflow.configSetId,
        binding: match.binding,
        pin: match.pin,
        action,
        beforeTargetText,
        ...(targetText === undefined ? {} : { targetText }),
        ...(targetValue === undefined ? {} : { targetValue }),
        baseText,
        candidateText,
        baseBytes,
        candidateBytes,
        baseDigest,
        proposedDigest,
        fingerprint: fingerprint(candidateWithoutFingerprint)
      });
    } catch (error) {
      if (error instanceof ApiError || error instanceof SyntaxError) continue;
      throw error;
    }
  }
  if (candidate.format === "json" && jsonBaseBytes) {
    let reconstructed = jsonBaseBytes;
    const seenPointers = new Set<string>();
    try {
      for (const plan of jsonPatchPlans) {
        const key = `${plan.rootPointer}:${plan.pointer}`;
        if (seenPointers.has(key)) throw new ApiError("CONFLICT", "Canonical JSON source has duplicate target locators.");
        seenPointers.add(key);
        reconstructed = plan.action === "delete"
          ? deleteJsonSourceMember(reconstructed, plan.pointer, plan.rootPointer).bytes
          : patchJsonSource(reconstructed, plan.pointer, plan.targetText!, plan.rootPointer);
      }
    } catch {
      reconstructed = Buffer.alloc(0);
    }
    if (!reconstructed.equals(candidateBytes)) {
      changes.length = 0;
    }
  }
  if (changes.length > 1) {
    const orderedChanges = [...changes].sort((left, right) => left.binding.bindingId.localeCompare(right.binding.bindingId));
    return {
      workflow,
      candidate,
      changes: orderedChanges,
      proofToken: workflow.proofToken ? candidateProofToken(workflow.proofToken, candidate, candidateDigest) : undefined,
      reason: "canonical-batch-writer-unavailable"
    };
  }
  if (changes.length !== 1) {
    return {
      workflow,
      candidate,
      reason: dtsRenderProofFailed ? "dts-render-not-byte-exact" : "candidate-changed-unbound-or-non-target-bytes"
    };
  }
  return {
    workflow,
    candidate,
    change: changes[0],
    proofToken: workflow.proofToken ? candidateProofToken(workflow.proofToken, candidate, candidateDigest) : undefined
  };
}

function previewBinding(change: SourceChange): CanonicalSourcePreviewBindingDto {
  return {
    bindingId: change.binding.bindingId,
    definitionId: change.binding.definitionId,
    baseCurrentValueId: change.pin.projectValueId,
    configRevisionId: change.pin.configRevisionId,
    sourcePinId: change.pin.sourcePinId,
    locator: sourceLocator(change.pin),
    baseDigest: change.baseDigest,
    proposedDigest: change.proposedDigest,
    action: change.action,
    beforeText: change.beforeTargetText,
    ...(change.targetText === undefined ? {} : { afterText: change.targetText })
  };
}

function previewFromInspection(inspection: SourceInspection, request?: RequestStatus | null): CanonicalSourcePreviewDto {
  const change = inspection.change;
  const candidate = inspection.candidate;
  const common = {
    candidateId: candidate.id,
    ...(candidate.fileId ? { fileId: candidate.fileId } : {}),
    format: candidate.format,
    ...(candidate.baseVersionId ? { baseVersionId: candidate.baseVersionId } : {}),
    ...(inspection.workflow.configSetId ? { configSetId: inspection.workflow.configSetId } : {}),
    ...(inspection.workflow.proofToken ? { cohortProofToken: inspection.workflow.proofToken } : {}),
    ...(inspection.proofToken ? { proofToken: inspection.proofToken } : {}),
    ...(request ? { request } : {})
  };
  if (!inspection.workflow.canonical) {
    return { kind: "legacy", canSubmit: false, ...common, ...(inspection.reason ? { reason: inspection.reason } : {}) };
  }
  if (inspection.changes && inspection.changes.length > 1) {
    return {
      kind: "canonical",
      canSubmit: false,
      ...common,
      reason: inspection.reason ?? "canonical-batch-writer-unavailable",
      baseDigest: inspection.changes[0]!.baseDigest,
      proposedDigest: inspection.changes[0]!.proposedDigest,
      bindings: inspection.changes.map(previewBinding),
      before: inspection.changes[0]!.baseText,
      after: inspection.changes[0]!.candidateText
    };
  }
  if (!change) {
    return { kind: "canonical", canSubmit: false, ...common, ...(inspection.reason ? { reason: inspection.reason } : {}) };
  }
  return {
    kind: "canonical",
    canSubmit: true,
    ...common,
    bindingId: change.binding.bindingId,
    definitionId: change.binding.definitionId,
    baseCurrentValueId: change.pin.projectValueId,
    configRevisionId: change.pin.configRevisionId,
    sourcePinId: change.pin.sourcePinId,
    locator: sourceLocator(change.pin),
    baseDigest: change.baseDigest,
    proposedDigest: change.proposedDigest,
    bindings: [previewBinding(change)],
    before: change.baseText,
    after: change.candidateText
  };
}

export async function getCanonicalSourceWorkflow(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; fileId: string }
) {
  return fileWorkflow(db, auth, input);
}

export async function previewCanonicalCandidate(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; candidateId: string }
): Promise<CanonicalSourcePreviewDto> {
  const inspection = await db.transaction((tx) => inspectCandidate(tx, objectStore, auth, input));
  const linked = await loadRequestForWorkflowLink(db, auth, inspection.candidate);
  const candidateRequest = linked ?? await loadRequestForCandidate(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    candidateId: input.candidateId
  });
  return previewFromInspection(inspection, candidateRequest ? { id: candidateRequest.id, status: candidateRequest.status } : null);
}

/** Caller-owned transaction; the returned proof is trusted only while these locks are held. */
export async function prepareCanonicalCandidateBatchInTransaction(
  tx: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; candidateId: string; expectedProofToken: string }
): Promise<CanonicalSourceBatchPrepareDto> {
  if (!canAdminParameters(auth) || !canEditParameters(auth, input.projectId)) {
    throw new ApiError("FORBIDDEN", "Parameter administration and project edit permission are required.");
  }
  return prepareCanonicalCandidateBatchLocked(tx, objectStore, auth, input);
}

async function prepareCanonicalCandidateBatchLocked(
  tx: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; candidateId: string; expectedProofToken: string }
): Promise<CanonicalSourceBatchPrepareDto> {
  const candidate = await getParameterFileCandidateById(tx, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    candidateId: input.candidateId
  });
  if (!candidate?.fileId || !candidate.baseVersionId) {
    throw new ApiError("NOT_FOUND", "Canonical source candidate has no owned existing file.");
  }
  const workflow = await fileWorkflow(tx, auth, { projectId: input.projectId, fileId: candidate.fileId });
  if (!workflow.canonical || !workflow.configSetId) {
    throw new ApiError("CONFLICT", "Candidate is not attached to a canonical source.", { reason: "file-is-not-canonical" });
  }
  const cohortBeforeLock = await loadSourceBindingCohortReadOnly(tx, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    configSetId: workflow.configSetId
  });
  const first = cohortBeforeLock.find((entry) => entry.sourcePinId && entry.oldValueId);
  const pin = first && await loadOwnedProjectValueSourcePin(tx, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    bindingId: first.bindingId,
    projectValueId: first.oldValueId
  });
  if (!pin) throw new ApiError("CONFLICT", "Canonical source cohort has no owned pin.", { reason: "source-pin-missing" });
  await lockCanonicalSourceScope(tx, pin, workflow.configSetId);
  const lockedCandidate = await getParameterFileCandidateByIdForUpdate(tx, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    candidateId: input.candidateId
  });
  if (!lockedCandidate || lockedCandidate.status !== "ready") {
    throw new ApiError("CONFLICT", "Canonical source candidate is not ready.", { reason: "candidate-is-not-reviewable" });
  }
  const inspection = await inspectCandidate(tx, objectStore, auth, input);
  if (!inspection.proofToken || inspection.proofToken !== input.expectedProofToken) {
    throw new ApiError("CONFLICT", "Canonical source proof changed after preview.", { reason: "source-proof-stale" });
  }
  if ((lockedCandidate.format !== "json" && lockedCandidate.format !== "dts") || !inspection.changes || inspection.changes.length < 2 || !inspection.workflow.configSetId || !inspection.workflow.proofToken) {
    throw new ApiError("CONFLICT", "Candidate has no exact multi-Binding source change.", {
      reason: inspection.reason ?? "canonical-batch-writer-unavailable"
    });
  }
  const changes = inspection.changes;
  const source = await loadCanonicalSourceSnapshot(tx, objectStore, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    bindingId: changes[0]!.binding.bindingId,
    projectValueId: changes[0]!.pin.projectValueId
  });
  const cohort = await loadCanonicalSourceCohort(tx, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    configSetId: inspection.workflow.configSetId
  });
  const members = source.manifest.members.map((member) => ({
    ...member,
    configSetId: inspection.workflow.configSetId!,
    isCandidateFile: member.fileId === lockedCandidate.fileId
  })).sort((left, right) => left.fileId.localeCompare(right.fileId));
  const targets = changes.map((change) => ({
    ...previewBinding(change),
    locator: change.pin.locator,
    ...(change.targetText === undefined ? {} : { targetText: change.targetText })
  }));
  const frozen = {
    kind: "canonical-source-batch" as const,
    organizationId: auth.organization.id,
    projectId: input.projectId,
    candidateId: lockedCandidate.id,
    fileId: lockedCandidate.fileId!,
    format: lockedCandidate.format,
    baseVersionId: lockedCandidate.baseVersionId!,
    configSetId: inspection.workflow.configSetId,
    baseDigest: changes[0]!.baseDigest,
    proposedDigest: changes[0]!.proposedDigest,
    cohortProofToken: inspection.workflow.proofToken,
    proofToken: inspection.proofToken,
    members,
    cohort,
    targets
  };
  return { ...frozen, batchProofDigest: proofDigest(frozen) };
}

/** Reviewer proof recheck under the same source locks, before the request row is locked. */
export async function recheckCanonicalCandidateBatchForReviewInTransaction(
  tx: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; candidateId: string; expectedProofToken: string }
): Promise<CanonicalSourceBatchPrepareDto> {
  if (!canReviewParameters(auth) || !canEditParameters(auth, input.projectId)
    || !canReviewParameterStage(auth, input.projectId, "software_review")
    || !await hasCurrentCanonicalReviewRole(tx, {
      organizationId: auth.organization.id, projectId: input.projectId, userId: auth.user.id
    })) {
    throw new ApiError("FORBIDDEN", "Project software review authorization is required.");
  }
  return prepareCanonicalCandidateBatchLocked(tx, objectStore, auth, input);
}

/** Freeze the locked source proof for the request owner without creating a request or changing values. */
export async function freezeCanonicalCandidateBatchSnapshotInTransaction(
  tx: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; candidateId: string; expectedProofToken: string }
): Promise<CanonicalSourceBatchPrepareDto> {
  const proof = await prepareCanonicalCandidateBatchInTransaction(tx, objectStore, auth, input);
  const snapshot = (await tx.query<{
    base_digest: string | null; proposed_digest: string | null; diff_digest: string | null;
    frozen_member_manifest: unknown; frozen_binding_manifest: unknown;
  }>(`select base_digest,proposed_digest,diff_digest,frozen_member_manifest,frozen_binding_manifest
      from project_parameter_file_candidates
     where id=$1 and organization_id=$2 and project_id=$3 for update`,
    [proof.candidateId, proof.organizationId, proof.projectId])).rows[0];
  if (!snapshot) throw new ApiError("NOT_FOUND", "Canonical source candidate was not found.");
  if (snapshot.base_digest === null) {
    await tx.query(`update project_parameter_file_candidates
        set base_digest=$4,proposed_digest=$5,diff_digest=$6,
            frozen_member_manifest=$7::jsonb,frozen_binding_manifest=$8::jsonb
        where id=$1 and organization_id=$2 and project_id=$3`,
      [proof.candidateId, proof.organizationId, proof.projectId, proof.baseDigest,
        proof.proposedDigest, proof.batchProofDigest, JSON.stringify(proof.members), JSON.stringify(proof.cohort)]);
  } else if (snapshot.base_digest !== proof.baseDigest
    || snapshot.proposed_digest !== proof.proposedDigest
    || snapshot.diff_digest !== proof.batchProofDigest
    || JSON.stringify(stableProofValue(snapshot.frozen_member_manifest)) !== JSON.stringify(stableProofValue(proof.members))
    || JSON.stringify(stableProofValue(snapshot.frozen_binding_manifest)) !== JSON.stringify(stableProofValue(proof.cohort))) {
    throw new ApiError("CONFLICT", "Candidate snapshot disagrees with the locked batch proof.", { reason: "candidate-snapshot-stale" });
  }
  return proof;
}

async function findExistingDraft(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string; sourcePinId: string; baseValueId: string; configRevisionId: string; baseDigest: string; proposedDigest: string; action: SourceAction }
) {
  const result = await db.query<{
    id: string; user_id: string | null; source_pin_id: string | null; base_current_value_id: string;
    config_revision_id: string; action: SourceAction; candidate_id: string | null;
    candidate_base_digest: string | null; candidate_proposed_digest: string | null; pending_request_id: string | null;
  }>(
    `select draft.id,draft.user_id,draft.source_pin_id,draft.base_current_value_id,draft.config_revision_id,draft.action,
            draft.candidate_id,draft.candidate_base_digest,draft.candidate_proposed_digest,
            pending.id as pending_request_id
       from project_parameter_value_drafts draft
       left join lateral (
         select request.id
           from project_parameter_value_change_requests request
          where request.organization_id=draft.organization_id and request.project_id=draft.project_id
            and request.draft_id=draft.id and request.status='pending'
          order by request.created_at desc, request.id desc limit 1
       ) pending on true
      where draft.organization_id=$1 and draft.project_id=$2 and draft.binding_id=$3
      for update of draft`,
    [input.organizationId, input.projectId, input.bindingId]
  );
  return result.rows.map((row) => ({
    ...row,
    exact: row.source_pin_id === input.sourcePinId
      && row.base_current_value_id === input.baseValueId
      && row.config_revision_id === input.configRevisionId
      && row.candidate_base_digest === input.baseDigest
      && row.candidate_proposed_digest === input.proposedDigest
      && row.action === input.action
  }));
}

async function ensureNoConflictingDraft(
  db: Queryable,
  auth: AuthContext,
  objectStore: ObjectStore,
  change: SourceChange
): Promise<{ draftId?: string; request?: RequestRecord }> {
  const rows = await findExistingDraft(db, {
    organizationId: auth.organization.id,
    projectId: change.pin.projectId,
    bindingId: change.binding.bindingId,
    sourcePinId: change.pin.sourcePinId,
    baseValueId: change.pin.projectValueId,
    configRevisionId: change.pin.configRevisionId,
    baseDigest: change.baseDigest,
    proposedDigest: change.proposedDigest,
    action: change.action
  });
  if (!rows.length) return {};
  const exact = rows.find((row) => row.exact && row.user_id === auth.user.id);
  const pending = rows.find((row) => row.pending_request_id);
  if (pending?.pending_request_id) {
    if (!pending.exact || pending.user_id !== auth.user.id) {
      throw new ApiError("CONFLICT", "The Binding already has a different pending canonical review.", {
        reason: "existing-canonical-draft",
        bindingId: change.binding.bindingId
      });
    }
    const request = await getCanonicalValueChangeRequest(db, {
      organizationId: auth.organization.id,
      projectId: change.pin.projectId,
      requestId: pending.pending_request_id
    });
    if (!request) throw new ApiError("CONFLICT", "The existing canonical review request is unavailable.");
    if (!pending.candidate_id) throw new ApiError("CONFLICT", "The existing canonical draft has no prepared candidate.");
    const prepared = await getParameterFileCandidateById(db, {
      organizationId: auth.organization.id,
      projectId: change.pin.projectId,
      candidateId: pending.candidate_id
    });
    if (!prepared?.storageKey) throw new ApiError("CONFLICT", "The existing canonical draft has no prepared content.");
    const preparedBytes = await getBoundedObject(objectStore, prepared.storageKey);
    if (!preparedBytes.equals(change.candidateBytes)) {
      throw new ApiError("CONFLICT", "The Binding already has a different pending canonical review.", {
        reason: "existing-canonical-draft",
        bindingId: change.binding.bindingId
      });
    }
    return { request };
  }
  if (rows.some((row) => row.user_id !== auth.user.id || !row.exact)) {
    throw new ApiError("CONFLICT", "The Binding already has a different canonical draft.", {
      reason: "existing-canonical-draft",
      bindingId: change.binding.bindingId
    });
  }
  if (exact) {
    if (!exact.candidate_id) {
      throw new ApiError("CONFLICT", "The existing canonical draft has no prepared candidate.", {
        reason: "existing-canonical-draft",
        bindingId: change.binding.bindingId
      });
    }
    const prepared = await getParameterFileCandidateById(db, {
      organizationId: auth.organization.id,
      projectId: change.pin.projectId,
      candidateId: exact.candidate_id
    });
    if (!prepared?.storageKey) {
      throw new ApiError("CONFLICT", "The existing canonical draft has no prepared content.", {
        reason: "existing-canonical-draft",
        bindingId: change.binding.bindingId
      });
    }
    const preparedBytes = await getBoundedObject(objectStore, prepared.storageKey);
    if (!preparedBytes.equals(change.candidateBytes)) {
      throw new ApiError("CONFLICT", "The existing canonical draft has different prepared bytes.", {
        reason: "existing-canonical-draft",
        bindingId: change.binding.bindingId
      });
    }
    return { draftId: exact.id };
  }
  return {};
}

async function submitInspectedCandidate(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  change: SourceChange,
  reason: string,
  requestId: string,
  refusalSink: TrustedRefusalAuditSink
): Promise<CanonicalSourceSubmitDto> {
  // Match the existing submitter lock order before reading any draft row. This
  // keeps a concurrent author from winning a same-Binding draft race.
  await db.query(
    `select id from dts_config_set where id=$1 and organization_id=$2 and project_id=$3 for update`,
    [change.configSetId, auth.organization.id, change.pin.projectId]
  );
  await db.query(`select id from project_parameter_files where config_set_id=$1 order by id for update`, [change.configSetId]);
  await lockCanonicalSourceCohort(db, change.pin);
  await loadCanonicalSourceCohort(db, {
    organizationId: auth.organization.id,
    projectId: change.pin.projectId,
    configSetId: change.configSetId
  });
  const reused = await ensureNoConflictingDraft(db, auth, objectStore, change);
  if (reused.request) {
    const linked = await linkParameterFileCandidateToCanonicalWorkflow(db, {
      organizationId: auth.organization.id,
      projectId: change.pin.projectId,
      candidateId: change.candidate.id,
      link: {
        kind: "canonical-source",
        fingerprint: change.fingerprint,
        bindingId: change.binding.bindingId,
        sourcePinId: change.pin.sourcePinId,
        preparedCandidateId: reused.request.candidate_id ?? "",
        draftId: reused.request.draft_id ?? "",
        requestId: reused.request.id,
        status: reused.request.status
      }
    });
    if (!linked) throw new ApiError("CONFLICT", "Canonical source candidate link was not retained.");
    return { requestId: reused.request.id, status: reused.request.status, replayed: true };
  }

  const invocation = createUserInvocation(auth);
  {
    const draft: CanonicalValueDraftDto = reused.draftId
      ? await (async () => {
          const existing = await db.query<{ id: string }>(`select id from project_parameter_value_drafts where organization_id=$1 and project_id=$2 and id=$3`, [auth.organization.id, change.pin.projectId, reused.draftId]);
          if (!existing.rows[0]) throw new ApiError("CONFLICT", "The canonical draft disappeared before submit.");
          // A matching unsubmitted draft is safe to submit; its prepared object was
          // compared in the conflict scan and remains immutable once submitted.
          return { id: reused.draftId } as CanonicalValueDraftDto;
        })()
      : await createCanonicalValueDraft(db, auth, {
          projectId: change.pin.projectId,
          bindingId: change.binding.bindingId,
          action: change.action,
          ...(change.action === "set" && change.format === "json"
            ? { sourceTarget: { format: "json" as const, sourceText: change.targetText! } }
            : {}),
          ...(change.action === "set" && change.format === "dts" ? { targetValue: change.targetValue! } : {}),
          reason,
          baseRevisionId: change.pin.configRevisionId,
          baseCurrentValueId: change.pin.projectValueId
        }, {
          objectStore: exactCandidateObjectStore(objectStore, change.candidateBytes),
          invocation,
          requestId,
          refusalSink
        });

    const { submitCanonicalValueChange } = await import("../parameter-bindings/drafts/changeService");
    const submitted = await submitCanonicalValueChange(db, auth, {
      projectId: change.pin.projectId,
      draftId: draft.id,
      invocation,
      requestId,
      refusalSink
    });
    const linked = await linkParameterFileCandidateToCanonicalWorkflow(db, {
      organizationId: auth.organization.id,
      projectId: change.pin.projectId,
      candidateId: change.candidate.id,
      link: {
        kind: "canonical-source",
        fingerprint: change.fingerprint,
        bindingId: change.binding.bindingId,
        sourcePinId: change.pin.sourcePinId,
        preparedCandidateId: submitted.candidateId ?? draft.candidateId ?? "",
        draftId: submitted.draftId ?? draft.id,
        requestId: submitted.id,
        status: submitted.status
      }
    });
    if (!linked) throw new ApiError("CONFLICT", "Canonical source candidate link was not retained.");
    return { requestId: submitted.id, status: submitted.status, replayed: false };
  }
}

async function lockCanonicalSourceScope(db: Database, pin: CanonicalValueSourcePin, configSetId: string) {
  await db.query(
    `select id from dts_config_set where id=$1 and organization_id=$2 and project_id=$3 for update`,
    [configSetId, pin.organizationId, pin.projectId]
  );
  await db.query(`select id from project_parameter_files where config_set_id=$1 order by id for update`, [configSetId]);
  await lockCanonicalSourceCohort(db, pin);
  await loadCanonicalSourceCohort(db, {
    organizationId: pin.organizationId,
    projectId: pin.projectId,
    configSetId
  });
}

async function lockCanonicalSourceForMutation(db: Database, change: SourceChange) {
  return lockCanonicalSourceScope(db, change.pin, change.configSetId);
}

export async function submitCanonicalCandidate(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: {
    projectId: string;
    candidateId: string;
    expectedCurrentVersionId: string;
    expectedProofToken: string;
    expectedWorkflowProofToken?: string;
    reason: string;
    requestId: string;
    refusalSink: TrustedRefusalAuditSink;
  },
  /** Internal rollback path shares the enclosing transaction and its object attempt. */
  parentAttempt?: CanonicalSourceAttempt
): Promise<CanonicalSourceSubmitDto> {
  if (!canAdminParameters(auth) || !canEditParameters(auth, input.projectId)) {
    throw new ApiError("FORBIDDEN", "Parameter administration and project edit permission are required.");
  }
  if (!input.reason.trim()) throw new ApiError("VALIDATION_FAILED", "A source review reason is required.");
  const submit = async (tx: Database, attempt: CanonicalSourceAttempt) => {
    const candidate = await getParameterFileCandidateByIdForUpdate(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      candidateId: input.candidateId
    });
    if (!candidate) throw new ApiError("NOT_FOUND", "Candidate file version was not found.", { candidateId: input.candidateId });
    const linked = await loadRequestForWorkflowLink(tx, auth, candidate);
    if (linked) return { requestId: linked.id, status: linked.status, replayed: true };
    const preparedRequest = await loadRequestForCandidate(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      candidateId: candidate.id
    });
    if (preparedRequest) return { requestId: preparedRequest.id, status: preparedRequest.status, replayed: true };
    const file = candidate.fileId
      ? await getProjectParameterFileById(tx, { organizationId: auth.organization.id, fileId: candidate.fileId })
      : null;
    if (!file || file.projectId !== input.projectId) throw new ApiError("CONFLICT", "Canonical source candidate has no owned file.");
    if (file.currentVersionId !== input.expectedCurrentVersionId || candidate.baseVersionId !== input.expectedCurrentVersionId) {
      throw new ApiError("CONFLICT", "Canonical source candidate base is stale.", {
        reason: "stale-base",
        expectedCurrentVersionId: input.expectedCurrentVersionId,
        actualCurrentVersionId: file.currentVersionId
      });
    }
    const inspection = await inspectCandidate(tx, objectStore, auth, input);
    if (!inspection.workflow.canonical || !inspection.change) {
      if (inspection.changes && inspection.proofToken && inspection.proofToken !== input.expectedProofToken) {
        throw new ApiError("CONFLICT", "Canonical source preview is stale; refresh the exact source proof.", {
          reason: "source-proof-stale"
        });
      }
      throw new ApiError("CONFLICT", "Candidate is not an exact single-binding canonical source change.", {
        reason: inspection.reason ?? "canonical-source-proof-failed"
      });
    }
    if (!inspection.proofToken || inspection.proofToken !== input.expectedProofToken) {
      throw new ApiError("CONFLICT", "Canonical source preview is stale; refresh the exact source proof.", {
        reason: "source-proof-stale"
      });
    }
    await lockCanonicalSourceForMutation(tx, inspection.change);
    if (input.expectedWorkflowProofToken) {
      const lockedWorkflow = await fileWorkflow(tx, auth, {
        projectId: input.projectId,
        fileId: candidate.fileId!
      });
      if (!lockedWorkflow.proofToken || lockedWorkflow.proofToken !== input.expectedWorkflowProofToken) {
        throw new ApiError("CONFLICT", "Canonical source changed after preview; refresh the exact source proof.", {
          reason: "source-proof-stale"
        });
      }
    }
    const lockedInspection = await inspectCandidate(tx, objectStore, auth, input);
    if (!lockedInspection.change || !lockedInspection.proofToken || lockedInspection.proofToken !== input.expectedProofToken) {
      throw new ApiError("CONFLICT", "Canonical source changed after preview; refresh the exact source proof.", {
        reason: "source-proof-stale"
      });
    }
    return submitInspectedCandidate(tx, attempt.objectStore, auth, lockedInspection.change, input.reason.trim(), input.requestId, input.refusalSink);
  };
  return (parentAttempt
    ? submit(db, parentAttempt)
    : withCanonicalSourceAttemptTransaction(db, objectStore, submit)
  ).catch((error) => rethrowSourceTransactionError(error));
}

export type CanonicalConflictChoice = "file" | "draft";

export type CanonicalConflictDecisionDto = Readonly<{
  candidateId: string;
  selectedBindingId: string;
  selectedDraftId: string;
  choice: CanonicalConflictChoice;
  fileId: string;
  baseVersionId: string;
  configSetId: string;
  sourceProofToken: string;
  cohortProofToken: string;
  sourceCandidateDigest: string;
  selectedDraftCandidateId: string;
  selectedDraftCandidateDigest: string;
  selectedDraftProof: string;
  selectedSourcePinId: string;
  selectedBaseValueId: string;
  selectedRevisionId: string;
  members: readonly CanonicalSourceBatchMemberDto[];
  cohort: readonly CanonicalSourceBatchCohortDto[];
  action: SourceAction;
  targetText?: string;
  decisionProofDigest: string;
}>;

/** Read-only selection proof. The caller must submit this exact digest under source locks. */
export async function prepareCanonicalConflictDecision(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; candidateId: string; selectedBindingId: string; selectedDraftId: string; choice: CanonicalConflictChoice }
): Promise<CanonicalConflictDecisionDto> {
  if (input.choice !== "file" && input.choice !== "draft") {
    throw new ApiError("VALIDATION_FAILED", "A file or draft choice is required.");
  }
  if (!canAdminParameters(auth) || !canEditParameters(auth, input.projectId)) {
    throw new ApiError("FORBIDDEN", "Parameter administration and project edit permission are required.");
  }
  const source = await inspectCandidate(db, objectStore, auth, input);
  const sourceChanges = source.changes ?? (source.change ? [source.change] : []);
  const fileChange = sourceChanges.find((change) => change.binding.bindingId === input.selectedBindingId);
  if (!fileChange || !source.proofToken || !source.workflow.proofToken || !source.candidate.fileId
    || !source.candidate.baseVersionId || !source.candidate.checksum || !source.workflow.configSetId
    || source.candidate.status !== "ready") {
    throw new ApiError("CONFLICT", "File candidate has no exact selected canonical target.", {
      reason: source.reason ?? "source-proof-stale"
    });
  }
  const selected = (await db.query<{
    id: string; binding_id: string; source_pin_id: string | null; base_current_value_id: string;
    config_revision_id: string; candidate_id: string | null; candidate_base_digest: string | null;
    candidate_proposed_digest: string | null; candidate_diff_digest: string | null;
    candidate_member_manifest: unknown; candidate_binding_manifest: unknown;
    action: SourceAction; target_value: unknown; user_id: string | null;
  }>(`select id,binding_id,source_pin_id,base_current_value_id,config_revision_id,
            candidate_id,candidate_base_digest,candidate_proposed_digest,candidate_diff_digest,
            action,target_value,user_id,candidate_member_manifest,candidate_binding_manifest
       from project_parameter_value_drafts
      where id=$1 and organization_id=$2 and project_id=$3 and binding_id=$4`,
    [input.selectedDraftId, auth.organization.id, input.projectId, input.selectedBindingId])).rows[0];
  if (!selected || selected.source_pin_id !== fileChange.pin.sourcePinId
    || selected.base_current_value_id !== fileChange.pin.projectValueId
    || selected.config_revision_id !== fileChange.pin.configRevisionId
    || !selected.candidate_id || !selected.candidate_base_digest || !selected.candidate_proposed_digest
    || !selected.candidate_diff_digest) {
    throw new ApiError("CONFLICT", "Selected canonical draft no longer matches the source base.", {
      reason: "selected-draft-stale"
    });
  }
  const prepared = await inspectCandidate(db, objectStore, auth, {
    projectId: input.projectId, candidateId: selected.candidate_id
  });
  if (!prepared.change || prepared.change.binding.bindingId !== input.selectedBindingId
    || prepared.candidate.status !== "ready"
    || prepared.change.pin.sourcePinId !== selected.source_pin_id
    || prepared.change.action !== selected.action
    || prepared.change.baseDigest !== selected.candidate_base_digest
    || prepared.change.proposedDigest !== selected.candidate_proposed_digest
    || prepared.candidate.checksum !== selected.candidate_proposed_digest
    || proofDigest(selected.target_value) !== proofDigest(selected.action === "delete" ? ""
      : prepared.change.format === "json"
        ? { kind: "json-source", value: parseJsonSource(prepared.change.targetText!) }
        : prepared.change.targetValue)) {
    throw new ApiError("CONFLICT", "Selected canonical draft lost its exact prepared bytes.", {
      reason: "selected-draft-stale"
    });
  }
  const chosen = input.choice === "file" ? fileChange : prepared.change;
  const sourceSnapshot = await loadCanonicalSourceSnapshot(db, objectStore, {
    organizationId: auth.organization.id, projectId: input.projectId,
    bindingId: input.selectedBindingId, projectValueId: fileChange.pin.projectValueId
  });
  const cohort = await loadSourceBindingCohortReadOnly(db, {
    organizationId: auth.organization.id, projectId: input.projectId,
    configSetId: source.workflow.configSetId
  });
  if (cohort.some((entry) => !entry.sourcePinId || !entry.oldValueId || !entry.locator || !entry.valueDigest)) {
    throw new ApiError("CONFLICT", "Canonical conflict source cohort is incomplete.", { reason: "source-pin-missing" });
  }
  const members = sourceSnapshot.manifest.members.map((member) => ({
    ...member, configSetId: source.workflow.configSetId!,
    isCandidateFile: member.fileId === source.candidate.fileId
  })).sort((left, right) => left.fileId.localeCompare(right.fileId));
  if (proofDigest(selected.candidate_member_manifest) !== proofDigest(members)
    || proofDigest(selected.candidate_binding_manifest) !== proofDigest(cohort)) {
    throw new ApiError("CONFLICT", "Selected draft source manifests are stale.", { reason: "selected-draft-stale" });
  }
  const draftArtifact = (await db.query<{
    base_digest: string | null; proposed_digest: string | null; diff_digest: string | null;
    frozen_member_manifest: unknown; frozen_binding_manifest: unknown;
  }>(`select base_digest,proposed_digest,diff_digest,frozen_member_manifest,frozen_binding_manifest
      from project_parameter_file_candidates
      where id=$1 and organization_id=$2 and project_id=$3`,
    [selected.candidate_id, auth.organization.id, input.projectId])).rows[0];
  if (!draftArtifact || draftArtifact.base_digest !== selected.candidate_base_digest
    || draftArtifact.proposed_digest !== selected.candidate_proposed_digest
    || draftArtifact.diff_digest !== selected.candidate_diff_digest
    || proofDigest(draftArtifact.frozen_member_manifest) !== proofDigest(members)
    || proofDigest(draftArtifact.frozen_binding_manifest) !== proofDigest(cohort)) {
    throw new ApiError("CONFLICT", "Selected draft candidate proof is stale.", { reason: "selected-draft-stale" });
  }
  for (const entry of cohort) {
    const sibling = await loadCanonicalSourceSnapshot(db, objectStore, {
      organizationId: auth.organization.id, projectId: input.projectId,
      bindingId: entry.bindingId, projectValueId: entry.oldValueId
    });
    if (sibling.manifest.configRevisionId !== fileChange.pin.configRevisionId
      || proofDigest(sibling.manifest.members) !== proofDigest(sourceSnapshot.manifest.members)) {
      throw new ApiError("CONFLICT", "Canonical conflict source cohort spans different revisions or members.", {
        reason: "source-cohort-stale"
      });
    }
  }
  const frozen = {
    candidateId: source.candidate.id,
    selectedBindingId: input.selectedBindingId,
    selectedDraftId: selected.id,
    choice: input.choice,
    fileId: source.candidate.fileId,
    baseVersionId: source.candidate.baseVersionId,
    configSetId: source.workflow.configSetId,
    sourceProofToken: source.proofToken,
    cohortProofToken: source.workflow.proofToken,
    sourceCandidateDigest: source.candidate.checksum,
    selectedDraftCandidateId: selected.candidate_id,
    selectedDraftCandidateDigest: selected.candidate_proposed_digest,
    selectedSourcePinId: fileChange.pin.sourcePinId,
    selectedBaseValueId: fileChange.pin.projectValueId,
    selectedRevisionId: fileChange.pin.configRevisionId,
    members,
    cohort,
    action: chosen.action,
    ...(chosen.targetText === undefined ? {} : { targetText: chosen.targetText }),
    selectedDraftProof: proofDigest({
      authorUserId: selected.user_id, action: selected.action, targetValue: selected.target_value,
      candidateId: selected.candidate_id, candidateDiffDigest: selected.candidate_diff_digest
    })
  };
  return { ...frozen, decisionProofDigest: proofDigest(frozen) };
}

/** D-owned source transaction seam for C's future conflict request route. */
export async function submitCanonicalConflictDecision(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; candidateId: string; selectedBindingId: string; selectedDraftId: string;
    choice: CanonicalConflictChoice; expectedDecisionProofDigest: string; reason: string;
    assignedToUserId: string; requestId: string; refusalSink: TrustedRefusalAuditSink }
): Promise<CanonicalSourceSubmitDto> {
  if (input.choice !== "file" && input.choice !== "draft") {
    throw new ApiError("VALIDATION_FAILED", "A file or draft choice is required.");
  }
  if (!input.reason.trim() || !input.assignedToUserId.trim()) {
    throw new ApiError("VALIDATION_FAILED", "A reason and assigned reviewer are required.");
  }
  return withCanonicalSourceAttemptTransaction(db, objectStore, async (tx, attempt) => {
    // Match the existing request owner's reviewer-before-source lock order.
    await lockUserById(tx, { organizationId: auth.organization.id, userId: input.assignedToUserId });
    const candidate = await getParameterFileCandidateByIdForUpdate(tx, {
      organizationId: auth.organization.id, projectId: input.projectId, candidateId: input.candidateId
    });
    if (!candidate) throw new ApiError("NOT_FOUND", "File candidate was not found.");
    const existing = candidate.impact?.canonicalSourceWorkflow;
    if (existing) {
      if (existing.conflictDecision?.decisionProofDigest !== input.expectedDecisionProofDigest
        || existing.conflictDecision.choice !== input.choice
        || existing.conflictDecision.selectedDraftId !== input.selectedDraftId
        || existing.bindingId !== input.selectedBindingId) {
        throw new ApiError("CONFLICT", "Candidate has a different canonical decision.", { reason: "conflict-decision-replay-mismatch" });
      }
      const request = await loadRequestForWorkflowLink(tx, auth, candidate);
      if (!request) throw new ApiError("CONFLICT", "Conflict decision receipt is unavailable.");
      return { requestId: request.id, status: request.status, replayed: true };
    }
    const decision = await prepareCanonicalConflictDecision(tx, objectStore, auth, input);
    if (decision.decisionProofDigest !== input.expectedDecisionProofDigest) {
      throw new ApiError("CONFLICT", "Canonical conflict decision proof is stale.", { reason: "source-proof-stale" });
    }
    const first = await loadOwnedProjectValueSourcePin(tx, {
      organizationId: auth.organization.id, projectId: input.projectId,
      bindingId: input.selectedBindingId, projectValueId: decision.selectedBaseValueId
    });
    if (!first) throw new ApiError("CONFLICT", "Selected source pin disappeared.");
    await lockCanonicalSourceScope(tx, first, decision.configSetId);
    const locked = await prepareCanonicalConflictDecision(tx, objectStore, auth, input);
    if (locked.decisionProofDigest !== input.expectedDecisionProofDigest) {
      throw new ApiError("CONFLICT", "Canonical conflict decision proof changed under source locks.", { reason: "source-proof-stale" });
    }
    const source = input.choice === "file"
      ? await inspectCandidate(tx, objectStore, auth, input)
      : await inspectCandidate(tx, objectStore, auth, { projectId: input.projectId, candidateId: decision.selectedDraftCandidateId });
    const chosen = (source.changes ?? (source.change ? [source.change] : []))
      .find((change) => change.binding.bindingId === input.selectedBindingId);
    if (!chosen || chosen.action !== decision.action || chosen.targetText !== decision.targetText) {
      throw new ApiError("CONFLICT", "Selected target changed after source proof.", { reason: "source-proof-stale" });
    }
    const rows = await findExistingDraft(tx, {
      organizationId: auth.organization.id, projectId: input.projectId, bindingId: input.selectedBindingId,
      sourcePinId: chosen.pin.sourcePinId, baseValueId: chosen.pin.projectValueId,
      configRevisionId: chosen.pin.configRevisionId, baseDigest: chosen.baseDigest,
      proposedDigest: chosen.proposedDigest, action: chosen.action
    });
    if (rows.some((row) => row.user_id === auth.user.id && row.id !== input.selectedDraftId)) {
      throw new ApiError("CONFLICT", "Submitting would overwrite another unselected draft.", { reason: "unselected-draft-would-change" });
    }
    if (rows.some((row) => row.id === input.selectedDraftId && row.pending_request_id)) {
      throw new ApiError("CONFLICT", "Selected draft already has a pending review.", { reason: "selected-draft-pending" });
    }
    const draft = await createCanonicalValueDraft(tx, auth, {
      projectId: input.projectId, bindingId: input.selectedBindingId,
      action: chosen.action,
      ...(chosen.action === "set" && chosen.format === "json"
        ? { sourceTarget: { format: "json" as const, sourceText: chosen.targetText! } }
        : {}),
      ...(chosen.action === "set" && chosen.format === "dts" ? { targetValue: chosen.targetValue! } : {}),
      reason: input.reason.trim(), baseRevisionId: decision.selectedRevisionId,
      baseCurrentValueId: decision.selectedBaseValueId
    }, {
      objectStore: attempt.objectStore, invocation: createUserInvocation(auth),
      requestId: input.requestId, refusalSink: input.refusalSink
    });
    const prepared = await inspectCandidate(tx, objectStore, auth, {
      projectId: input.projectId, candidateId: draft.candidateId!
    });
    if (!prepared.change || prepared.change.binding.bindingId !== input.selectedBindingId
      || prepared.change.action !== decision.action || prepared.change.targetText !== decision.targetText
      || prepared.workflow.proofToken !== decision.cohortProofToken) {
      throw new ApiError("CONFLICT", "Derived request would apply more than the selected target.", { reason: "selected-target-proof-failed" });
    }
    const { submitCanonicalValueChange } = await import("../parameter-bindings/drafts/changeService");
    const request = await submitCanonicalValueChange(tx, auth, {
      projectId: input.projectId, draftId: draft.id, assignedToUserId: input.assignedToUserId,
      invocation: createUserInvocation(auth), requestId: input.requestId,
      refusalSink: input.refusalSink
    });
    const linked = await linkParameterFileCandidateToCanonicalWorkflow(tx, {
      organizationId: auth.organization.id, projectId: input.projectId, candidateId: input.candidateId,
      link: {
        kind: "canonical-source", fingerprint: decision.decisionProofDigest,
        bindingId: input.selectedBindingId, sourcePinId: decision.selectedSourcePinId,
        preparedCandidateId: draft.candidateId!, draftId: draft.id, requestId: request.id,
        status: request.status,
        conflictDecision: {
          choice: input.choice, selectedDraftId: input.selectedDraftId,
          selectedDraftCandidateId: decision.selectedDraftCandidateId,
          selectedDraftCandidateDigest: decision.selectedDraftCandidateDigest,
          sourceProofToken: decision.sourceProofToken,
          sourceCandidateDigest: decision.sourceCandidateDigest,
          decisionProofDigest: decision.decisionProofDigest
        }
      }
    });
    if (!linked) throw new ApiError("CONFLICT", "Conflict decision link was not retained.");
    await writeTrustedGovernanceAudit(asAuditTx(tx), createUserInvocation(auth), {
      action: "value-change-submitted",
      organizationId: auth.organization.id,
      projectId: input.projectId,
      targetType: "project-parameter-value-change-request",
      targetId: request.id,
      metadata: {
        requestId: request.id, choice: input.choice,
        selectedBindingId: input.selectedBindingId,
        selectedDraftId: input.selectedDraftId,
        sourceCandidateId: input.candidateId,
        preparedCandidateId: draft.candidateId,
        decisionProofDigest: decision.decisionProofDigest
      }
    }, input.requestId);
    return { requestId: request.id, status: request.status, replayed: false };
  }).catch((error) => rethrowSourceTransactionError(error));
}

/** Recheck the uploaded file and selected draft artifacts before an approved conflict decision applies. */
export async function recheckCanonicalConflictDecisionForReview(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; requestId: string; preparedCandidateId: string; bindingId: string; sourcePinId: string }
): Promise<void> {
  const links = await db.query<{ id: string }>(`select id from project_parameter_file_candidates
    where organization_id=$1 and project_id=$2
      and impact->'canonicalSourceWorkflow'->>'requestId'=$3
      and impact->'canonicalSourceWorkflow'->'conflictDecision' is not null
    for update`, [auth.organization.id, input.projectId, input.requestId]);
  const receipts = await db.query<{ metadata: Record<string, unknown> }>(`select metadata from audit_events
    where organization_id=$1 and project_id=$2 and target_id=$3
      and action='value-change-submitted' and metadata ? 'decisionProofDigest'`,
    [auth.organization.id, input.projectId, input.requestId]);
  if (!links.rows.length && !receipts.rows.length) return;
  if (!receipts.rows.length) throw new ApiError("CONFLICT", "Conflict decision audit receipt is missing.", { reason: "conflict-decision-stale" });
  if (receipts.rows.length !== 1) throw new ApiError("CONFLICT", "Conflict decision has multiple audit receipts.");
  const receipt = receipts.rows[0]!.metadata;
  if (typeof receipt.sourceCandidateId !== "string" || typeof receipt.decisionProofDigest !== "string") {
    throw new ApiError("CONFLICT", "Conflict decision audit receipt is incomplete.");
  }
  if (!links.rows.length) throw new ApiError("CONFLICT", "Conflict decision lost its uploaded candidate link.", { reason: "conflict-decision-stale" });
  if (links.rows.length !== 1) throw new ApiError("CONFLICT", "Conflict decision has multiple source receipts.");
  if (links.rows[0]!.id !== receipt.sourceCandidateId) {
    throw new ApiError("CONFLICT", "Conflict decision receipt disagrees with its uploaded candidate link.", { reason: "conflict-decision-stale" });
  }
  const candidate = await getParameterFileCandidateById(db, {
    organizationId: auth.organization.id, projectId: input.projectId, candidateId: links.rows[0]!.id
  });
  const link = candidate?.impact?.canonicalSourceWorkflow;
  const decision = link?.conflictDecision;
  if (!candidate || !link || !decision || link.preparedCandidateId !== input.preparedCandidateId
    || link.bindingId !== input.bindingId || link.sourcePinId !== input.sourcePinId
    || link.fingerprint !== decision.decisionProofDigest
    || decision.decisionProofDigest !== receipt.decisionProofDigest
    || decision.choice !== receipt.choice
    || decision.selectedDraftId !== receipt.selectedDraftId
    || link.preparedCandidateId !== receipt.preparedCandidateId
    || candidate.status !== "ready") {
    throw new ApiError("CONFLICT", "Conflict decision receipt disagrees with the pending request.", { reason: "conflict-decision-stale" });
  }
  const inspection = await inspectCandidate(db, objectStore, auth, {
    projectId: input.projectId, candidateId: candidate.id
  });
  const changed = inspection.changes ?? (inspection.change ? [inspection.change] : []);
  if (inspection.proofToken !== decision.sourceProofToken
    || candidate.checksum !== decision.sourceCandidateDigest
    || !changed.some((change) => change.binding.bindingId === input.bindingId
      && change.pin.sourcePinId === input.sourcePinId)) {
    throw new ApiError("CONFLICT", "Uploaded conflict source changed after review submission.", { reason: "conflict-decision-stale" });
  }
  const draftCandidate = await getParameterFileCandidateById(db, {
    organizationId: auth.organization.id, projectId: input.projectId,
    candidateId: decision.selectedDraftCandidateId
  });
  if (!draftCandidate?.storageKey || draftCandidate.checksum !== decision.selectedDraftCandidateDigest) {
    throw new ApiError("CONFLICT", "Selected draft source artifact is unavailable.", { reason: "selected-draft-stale" });
  }
  const draftBytes = await getBoundedObject(objectStore, draftCandidate.storageKey);
  if (digest(draftBytes) !== decision.selectedDraftCandidateDigest
    || draftCandidate.sizeBytes !== draftBytes.length) {
    throw new ApiError("CONFLICT", "Selected draft source bytes changed after submission.", { reason: "selected-draft-stale" });
  }
}

export async function rollbackCanonicalSource(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; fileId: string; versionId: string; expectedCurrentVersionId: string; expectedProofToken: string; reason: string; requestId: string; refusalSink: TrustedRefusalAuditSink }
): Promise<CanonicalSourceSubmitDto> {
  if (!canAdminParameters(auth) || !canEditParameters(auth, input.projectId)) {
    throw new ApiError("FORBIDDEN", "Parameter administration and project edit permission are required.");
  }
  if (!input.reason.trim()) throw new ApiError("VALIDATION_FAILED", "A source rollback reason is required.");
  return withCanonicalSourceAttemptTransaction(db, objectStore, async (tx, attempt) => {
    const file = await getProjectParameterFileById(tx, { organizationId: auth.organization.id, fileId: input.fileId });
    if (!file || file.projectId !== input.projectId) throw new ApiError("NOT_FOUND", "Project parameter file was not found.");
    const target = await getFileVersionById(tx, { versionId: input.versionId });
    if (!target || target.fileId !== file.id) throw new ApiError("NOT_FOUND", "Project parameter file version was not found.");
    const bytes = await getBoundedObject(objectStore, target.storageKey);
    const targetDigest = digest(bytes);
    if (target.checksum && target.checksum !== targetDigest) {
      throw new ApiError("CONFLICT", "Rollback source version storage digest does not match its immutable metadata.", {
        reason: "version-storage-digest-mismatch"
      });
    }
    if (target.sizeBytes !== undefined && target.sizeBytes !== bytes.length) {
      throw new ApiError("CONFLICT", "Rollback source version size does not match its immutable metadata.", {
        reason: "version-storage-size-mismatch"
      });
    }
    // A retry after approval may observe the newly-created current version and
    // therefore fail the original CAS. Reuse the exact linked candidate first.
    const priorCandidates = (await listParameterFileCandidates(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      fileId: file.id,
      includeAbandoned: true
    })).filter((candidate) =>
      candidate.baseVersionId === input.expectedCurrentVersionId
      && candidate.checksum === targetDigest
      && Boolean(candidate.storageKey)
    );
    for (const candidate of priorCandidates) {
      const linked = await loadRequestForWorkflowLink(tx, auth, candidate);
      if (linked) return { requestId: linked.id, status: linked.status, replayed: true };
    }
    const workflow = await fileWorkflow(tx, auth, { projectId: input.projectId, fileId: file.id });
    if (!workflow.canonical || !workflow.configSetId || !workflow.proofToken || workflow.proofToken !== input.expectedProofToken) {
      throw new ApiError("CONFLICT", "Canonical source workflow changed after preview; refresh the exact source proof.", {
        reason: "source-proof-stale"
      });
    }
    if (file.currentVersionId !== input.expectedCurrentVersionId) throw new ApiError("CONFLICT", "Canonical source file base is stale.", { reason: "stale-base" });
    if (target.id === file.currentVersionId) throw new ApiError("CONFLICT", "The chosen version is already current.");
    const existing = (await listParameterFileCandidates(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      fileId: file.id,
      includeAbandoned: false
    })).filter((candidate) =>
      candidate.baseVersionId === input.expectedCurrentVersionId
      && candidate.checksum === targetDigest
      && candidate.status !== "abandoned"
      && Boolean(candidate.storageKey)
    );
    for (const candidate of existing) {
      const inspection = await inspectCandidate(tx, objectStore, auth, {
        projectId: input.projectId,
        candidateId: candidate.id
      });
      if (inspection.change?.proposedDigest === targetDigest) {
        if (!inspection.proofToken) throw new ApiError("CONFLICT", "Rollback candidate has no source proof.", { reason: "source-proof-missing" });
        return await submitCanonicalCandidate(tx, attempt.objectStore, auth, {
          projectId: input.projectId,
          candidateId: candidate.id,
          expectedCurrentVersionId: input.expectedCurrentVersionId,
          expectedProofToken: inspection.proofToken,
          expectedWorkflowProofToken: input.expectedProofToken,
          reason: input.reason,
          requestId: input.requestId,
          refusalSink: input.refusalSink
        }, attempt);
      }
    }
    {
      const candidate = await createCandidate(tx, attempt.objectStore, auth, {
        projectId: input.projectId,
        fileId: file.id,
        fileName: file.fileName,
        bytes
      }, { requestId: input.requestId });
      const candidateInspection = await inspectCandidate(tx, objectStore, auth, {
        projectId: input.projectId,
        candidateId: candidate.id
      });
      if (!candidateInspection.proofToken || !candidateInspection.change) {
        throw new ApiError("CONFLICT", "Rollback candidate has no exact source proof.", {
          reason: candidateInspection.reason ?? "source-proof-missing"
        });
      }
      return await submitCanonicalCandidate(tx, attempt.objectStore, auth, {
        projectId: input.projectId,
        candidateId: candidate.id,
        expectedCurrentVersionId: input.expectedCurrentVersionId,
        expectedProofToken: candidateInspection.proofToken,
        expectedWorkflowProofToken: input.expectedProofToken,
        reason: input.reason,
        requestId: input.requestId,
        refusalSink: input.refusalSink
      }, attempt);
    }
  }).catch((error) => rethrowSourceTransactionError(error));
}

export async function syncCanonicalSource(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; fileId: string; versionId: string }
) {
  return db.transaction(async (tx) => {
    const workflow = await fileWorkflow(tx, auth, { projectId: input.projectId, fileId: input.fileId });
    if (!workflow.canonical || !workflow.configSetId) return null;
    const file = await getProjectParameterFileById(tx, { organizationId: auth.organization.id, fileId: input.fileId });
    if (!file || file.projectId !== input.projectId) throw new ApiError("NOT_FOUND", "Project parameter file was not found.");
    if (file.currentVersionId !== input.versionId) throw new ApiError("CONFLICT", "Canonical manual sync only accepts the current pinned version.", { reason: "stale-base" });
    const bindings = await loadSourceBindingCohortReadOnly(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      configSetId: workflow.configSetId
    });
    const first = bindings.find((binding) => binding.sourcePinId && binding.oldValueId);
    if (!first) throw new ApiError("CONFLICT", "Canonical source cohort has no active owned pin to validate.", { reason: "source-pin-missing" });
    if (first?.sourcePinId && first.oldValueId) {
      const pin = await loadOwnedProjectValueSourcePin(tx, {
        organizationId: auth.organization.id, projectId: input.projectId,
        bindingId: first.bindingId, projectValueId: first.oldValueId
      });
      if (!pin || !pin.configRevisionId.trim()) throw new ApiError("CONFLICT", "Canonical source has no exact config revision.", { reason: "source-config-revision-required" });
      await lockCanonicalSourceScope(tx, pin, workflow.configSetId);
      const cohort = await loadCanonicalSourceCohort(tx, {
        organizationId: auth.organization.id, projectId: input.projectId, configSetId: workflow.configSetId
      });
      if (JSON.stringify(cohort) !== JSON.stringify(bindings)) throw new ApiError("CONFLICT", "Canonical source cohort changed during validation.", { reason: "source-proof-busy" });
      const source = await loadExactSourceRevisionForProof(tx, objectStore, {
        organizationId: auth.organization.id, projectId: input.projectId,
        configSetId: workflow.configSetId, configRevisionId: pin.configRevisionId,
        fileId: pin.fileId, fileVersionId: pin.fileVersionId
      });
      for (const binding of cohort) {
        const currentPin = await loadOwnedProjectValueSourcePin(tx, {
          organizationId: auth.organization.id, projectId: input.projectId,
          bindingId: binding.bindingId, projectValueId: binding.oldValueId
        });
        if (!currentPin || currentPin.sourcePinId !== binding.sourcePinId
          || currentPin.configRevisionId !== pin.configRevisionId
          || !source.members.some((member) => member.fileId === currentPin.fileId && member.fileVersionId === currentPin.fileVersionId)) {
          throw new ApiError("CONFLICT", "Canonical source cohort has inconsistent revision members.", { reason: "source-membership-drift" });
        }
      }
      const current = await tx.query<{ id: string; current_version_id: string | null; config_set_role: string | null; config_set_sort_order: number; format: string }>(
        `select id,current_version_id,config_set_role,config_set_sort_order,format
           from project_parameter_files where config_set_id=$1 order by id`,
        [workflow.configSetId]
      );
      if (current.rows.length !== source.members.length || current.rows.some((member) => !source.members.some((pinned) => canonicalSourceMemberMatchesCurrentFile({ fileId: pinned.fileId, fileVersionId: pinned.fileVersionId, role: pinned.role, sortOrder: pinned.sortOrder, format: pinned.format }, member)))) {
        throw new ApiError("CONFLICT", "Canonical source members are out of sync; use a reviewed source candidate.", { reason: "source-membership-drift" });
      }
    }
    return {
      draftsCreated: 0,
      unchanged: bindings.length,
      unmatched: 0,
      skipped: false,
      identityFallbackUses: 0,
      sourceWorkflow: "canonical" as const,
      message: "Canonical source is consistent; no legacy synchronization was run."
    };
  }).catch((error) => rethrowSourceTransactionError(error));
}
