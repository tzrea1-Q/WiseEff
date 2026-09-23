import { createHash } from "node:crypto";

import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import { canAdminParameters, canEditParameters } from "../parameter-kernel/policy";
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
import type { ParameterFileFormat, ProjectParameterFileCandidateDto } from "./types";

export type CanonicalSourceWorkflowDto = {
  canonical: boolean;
  configSetId?: string;
  reason?: string;
  bindingCount: number;
  proofToken?: string;
};

export type CanonicalSourcePreviewDto = {
  kind: "legacy" | "canonical";
  canSubmit: boolean;
  reason?: string;
  candidateId: string;
  fileId?: string;
  format: ParameterFileFormat;
  baseVersionId?: string;
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
  request?: { id: string; status: CanonicalChangeRequestStatus };
};

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
  if (changes.length !== 1) {
    return {
      workflow,
      candidate,
      reason: changes.length === 0
        ? (dtsRenderProofFailed ? "dts-render-not-byte-exact" : "candidate-changed-unbound-or-non-target-bytes")
        : "candidate-changes-multiple-bindings"
    };
  }
  return {
    workflow,
    candidate,
    change: changes[0],
    proofToken: workflow.proofToken ? candidateProofToken(workflow.proofToken, candidate, candidateDigest) : undefined
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
    ...(inspection.proofToken ? { proofToken: inspection.proofToken } : {}),
    ...(request ? { request } : {})
  };
  if (!inspection.workflow.canonical) {
    return { kind: "legacy", canSubmit: false, ...common, ...(inspection.reason ? { reason: inspection.reason } : {}) };
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
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; fileId: string; versionId: string }
) {
  const workflow = await fileWorkflow(db, auth, { projectId: input.projectId, fileId: input.fileId });
  if (!workflow.canonical || !workflow.configSetId) return null;
  const file = await getProjectParameterFileById(db, { organizationId: auth.organization.id, fileId: input.fileId });
  if (!file || file.projectId !== input.projectId) throw new ApiError("NOT_FOUND", "Project parameter file was not found.");
  if (file.currentVersionId !== input.versionId) throw new ApiError("CONFLICT", "Canonical manual sync only accepts the current pinned version.", { reason: "stale-base" });
  const bindings = await loadSourceBindingCohortReadOnly(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    configSetId: workflow.configSetId
  });
  const first = bindings.find((binding) => binding.sourcePinId && binding.oldValueId);
  if (first?.sourcePinId && first.oldValueId) {
    const pin = await loadOwnedProjectValueSourcePin(db, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      bindingId: first.bindingId,
      projectValueId: first.oldValueId
    });
    if (!pin || !pin.configRevisionId.trim()) throw new ApiError("CONFLICT", "Canonical source has no exact config revision.", { reason: "source-config-revision-required" });
    const source = await loadExactSourceRevisionForProof(db, objectStore, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      configSetId: workflow.configSetId,
      configRevisionId: pin.configRevisionId,
      fileId: pin.fileId,
      fileVersionId: pin.fileVersionId
    });
    const current = await db.query<{ id: string; current_version_id: string | null; config_set_role: string | null; config_set_sort_order: number; format: string }>(
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
    unchanged: bindings.filter((binding) => binding.sourcePinId).length,
    unmatched: 0,
    skipped: false,
    identityFallbackUses: 0,
    sourceWorkflow: "canonical" as const,
    message: "Canonical source is consistent; no legacy synchronization was run."
  };
}
