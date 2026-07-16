import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import {
  notifyParameterImportCompleted,
  notifyParameterMergeCompleted,
  notifyParameterReviewAdvanced,
  notifyParameterReviewRejected,
  notifyParameterReviewSubmitted
} from "../notifications/producers";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { nodePathToParameterIdentity } from "../parameter-files/pathMapper";
import { getProjectParameterFileById } from "../parameter-files/repository";
import { writebackMergedParameterValue } from "../parameter-files/writebackService";
import { resolveBindingWriteLock, resolveInitializationSuggestion } from "../parameter-topology/editService";
import { canAdminParameters, canEditParameters, canMergeParameters, canReviewParameterStage, canViewParameters } from "./policy";
import { assertSensitiveNodeWriteAllowed } from "./sensitiveNode";
import { mustUseSemanticParameterIdentity } from "./semanticParameterReads";
import type { InitializationSuggestionDto } from "./types";
import {
  applyAddedImportItem,
  applyUpdatedImportItem,
  bindParameterSource,
  createChangeRequest,
  getImportBatchForUpdate,
  createSubmissionItem,
  createSubmissionRound,
  deleteDraft as deleteDraftRow,
  deleteDraftForParameter,
  findOpenChangeRequest,
  findProjectValueBySource,
  getChangeRequestById,
  getDraftWriteLock,
  getProjectById,
  getProjectParameterForUpdate,
  getSubmissionRoundById,
  getSubmissionRoundSubmitterUserId,
  hasOpenFileSyncConflict,
  hasEligibleWorkflowAssignee,
  insertImportBatch,
  insertProjectParameterValueWithSource,
  insertReviewDecision,
  listParameterDefinitionsForImport,
  listChangeRequests as listChangeRequestRows,
  listDraftsForUser,
  listReviewDecisions,
  listReviewDecisionsForRequestIds,
  listChangeRequestWorkflowStateByIds,
  listUserNamesByIds,
  listSubmissionRounds as listSubmissionRoundRows,
  markImportBatchApplied,
  mergeChangeRequest,
  type ParameterDefinitionImportCandidate,
  type PersistedImportBatchItem,
  type ProjectParameterValueMatch,
  updateChangeRequestStatus,
  updateSubmissionRoundStatus,
  updateSubmissionRoundStatusFromRequests,
  upsertDraft,
  withdrawOpenChangeRequestsForRound,
  countParameterModuleChildren,
  countParametersForModule,
  createParameterModule,
  deleteParameterModule,
  getParameterModuleById,
  getParameterModuleByName,
  listParameterModules,
  moveParameterModule,
  updateParameterModule,
  type ListParametersQuery as RepositoryListParametersQuery
} from "./repository";
import {
  applyImportBatchBodySchema,
  createImportBatchBodySchema,
  parseDtsImportBodySchema,
  type CreateParameterModuleBody,
  type ListParametersQuery,
  type MoveParameterModuleBody,
  type ParseDtsImportBody,
  type UpdateParameterModuleBody
} from "./schemas";
import { parseDtsImportSource } from "./importDtsParse";
import { getNextParameterStatus, parameterStatusLabels, type ParameterChangeRequestStatus, type ParameterSubmissionRoundStatus } from "./status";
import type { ChangeRequestDto, ParameterImportSourceItemDto, ParameterImportSummaryDto, ParameterModuleDto } from "./types";
import { buildSubmissionWorkflowTrail } from "../../../src/domain/parameters/submissionWorkflowTrail";
import { deriveSubmissionTimeline } from "../../../src/parameterSubmissionTimeline";

type ServiceContext = AuditCorrelationContext & {
  objectStore?: ObjectStore;
  actorType?: "user" | "agent" | "system";
};

export type SaveDraftInput = {
  projectId: string;
  parameterId: string;
  targetValue: string;
  reason: string;
  projectParameterBindingId?: string;
  parameterSpecId?: string;
};

export type SubmitParameterChangesInput = {
  projectId: string;
  items: Array<{
    parameterId: string;
    targetValue: string;
    reason: string;
    projectParameterBindingId?: string;
    parameterSpecId?: string;
  }>;
  reason?: string;
  assignees?: {
    hardwareCommitterId?: string;
    softwareCommitterId?: string;
    softwareUserId?: string;
  };
};

/** One structured DTS property edit unit (browser editor → change request). */
export type StructuredEditUnit = {
  fileId: string;
  nodePath: string;
  propertyName: string;
  /** CST-preserving property text; must be used as CR targetValue / writeback payload. */
  rawText: string;
  reason?: string;
  projectParameterBindingId?: string;
  parameterSpecId?: string;
};

export type SubmitStructuredEditsInput = {
  projectId: string;
  edits: StructuredEditUnit[];
  reason?: string;
  assignees?: SubmitParameterChangesInput["assignees"];
};

export function sourceNodePathForStructuredEdit(edit: Pick<StructuredEditUnit, "nodePath" | "propertyName">) {
  const nodePath = edit.nodePath.trim();
  const propertyName = edit.propertyName.trim();
  return nodePath ? `${nodePath}/${propertyName}` : propertyName;
}

/**
 * Initialization suggestions never treat exampleValue as enforced.
 * Prefer policyTarget, then schemaDefault.
 */
export function getInitializationSuggestion(input: {
  policyTarget?: unknown;
  schemaDefault?: unknown;
  exampleValue?: unknown;
}): InitializationSuggestionDto {
  return resolveInitializationSuggestion(input);
}

export async function resolveStructuredEditToParameter(
  db: Queryable,
  auth: AuthContext,
  projectId: string,
  edit: StructuredEditUnit
): Promise<ProjectParameterValueMatch> {
  const file = await getProjectParameterFileById(db, {
    organizationId: auth.organization.id,
    fileId: edit.fileId
  });
  if (!file || file.projectId !== projectId) {
    throw new ApiError("NOT_FOUND", "Project parameter file was not found.", 404, {
      fileId: edit.fileId,
      projectId
    });
  }

  const sourceFileName = file.fileName;
  const sourceNodePath = sourceNodePathForStructuredEdit(edit);
  if (!sourceNodePath) {
    throw new ApiError("VALIDATION_FAILED", "Structured edit requires nodePath or propertyName.", 400);
  }

  const bySource = await findProjectValueBySource(db, {
    organizationId: auth.organization.id,
    projectId,
    sourceFileName,
    sourceNodePath
  });
  if (bySource) {
    return bySource;
  }

  let identity: { name: string; module: string };
  try {
    identity = nodePathToParameterIdentity(sourceNodePath);
  } catch {
    throw new ApiError("VALIDATION_FAILED", `Invalid structured edit path: ${sourceNodePath}`, 400, {
      sourceNodePath
    });
  }

  // Fail closed: (name, module) identity fallback is retired. New source bindings may still insert.
  return insertProjectParameterValueWithSource(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId,
    definitionId: randomUUID(),
    name: identity.name,
    module: identity.module,
    currentValue: "",
    recommendedValue: "",
    actorUserId: auth.user.id,
    sourceFileName,
    sourceNodePath
  });
}

/**
 * Map structured DTS edits onto project parameter identity rows and submit via the
 * existing draft → submission_round → change_request flow. CR targetValue is rawText.
 */
export async function submitStructuredEdits(
  db: Database,
  auth: AuthContext,
  input: SubmitStructuredEditsInput,
  context: ServiceContext = {}
) {
  requireCanEdit(auth);

  if (input.edits.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "At least one structured edit is required.", 400);
  }

  const seenKeys = new Set<string>();
  const items: SubmitParameterChangesInput["items"] = [];

  for (const edit of input.edits) {
    const key = `${edit.fileId}:${sourceNodePathForStructuredEdit(edit)}`;
    if (seenKeys.has(key)) {
      throw new ApiError("VALIDATION_FAILED", "Duplicate structured edit for the same property.", 400, {
        fileId: edit.fileId,
        nodePath: edit.nodePath,
        propertyName: edit.propertyName
      });
    }
    seenKeys.add(key);

    const parameter = await resolveStructuredEditToParameter(db, auth, input.projectId, edit);
    const reason =
      edit.reason?.trim() ||
      `Structured edit: ${sourceNodePathForStructuredEdit(edit)}`;

    await upsertDraft(db, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      projectId: input.projectId,
      parameterId: parameter.id,
      userId: auth.user.id,
      targetValue: edit.rawText,
      reason,
      origin: "manual",
      projectParameterBindingId: edit.projectParameterBindingId,
      parameterSpecId: edit.parameterSpecId
    });

    items.push({
      parameterId: parameter.id,
      targetValue: edit.rawText,
      reason,
      projectParameterBindingId: edit.projectParameterBindingId,
      parameterSpecId: edit.parameterSpecId
    });
  }

  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: context.actorType ?? "user",
    app: "parameter-management",
    kind: "parameter-structured-edit-submit",
    action: "submit",
    severity: "Medium",
    targetType: "parameter-submission-round",
    targetId: input.projectId,
    metadata: {
      editCount: input.edits.length,
      parameterIds: items.map((item) => item.parameterId)
    },
    traceId: context.requestId ?? randomUUID()
  });

  return submitParameterChanges(
    db,
    auth,
    {
      projectId: input.projectId,
      items,
      reason: input.reason,
      assignees: input.assignees
    },
    context
  );
}

export type DraftListQuery = {
  projectId?: string;
};

export type SubmissionRoundListQuery = {
  projectId?: string;
  status?: ParameterSubmissionRoundStatus[];
};

export type ChangeRequestListQuery = {
  projectId?: string;
  status?: ParameterChangeRequestStatus[];
  assignedTo?: string;
};

export type ReviewParameterChangeInput = {
  requestId: string;
  decision: "advance" | "reject";
  note?: string;
  expectedVersion?: number;
};

export type CreateImportPreviewInput = {
  projectId: string;
  sourceName: string;
  items: Array<ParameterImportSourceItemDto & { id?: string }>;
  reviewMetadata?: {
    skippedRows?: Array<{ rowKey?: string; name?: string; module?: string; reason: string }>;
    notes?: string;
  };
};

export type ApplyImportBatchInput = {
  batchId: string;
  selectedItemIds?: string[];
  reviewMetadata?: {
    skippedRows?: Array<{ rowKey?: string; name?: string; module?: string; reason: string }>;
    notes?: string;
  };
};

function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
  }
}

function requireCanEdit(auth: AuthContext) {
  if (!canEditParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter edit permission is required.", 403);
  }
}

function requireCanAdminImport(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Admin access is required for parameter import.", 403);
  }
}

export function parseDtsImportForAuth(auth: AuthContext, input: ParseDtsImportBody) {
  requireCanAdminImport(auth);
  const parsed = parseDtsImportBodySchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", "Invalid DTS import parse request.", 400, {
      issues: parsed.error.issues
    });
  }
  return parseDtsImportSource(parsed.data);
}

function getReviewForbiddenMessage(fromStatus: ParameterChangeRequestStatus) {
  if (fromStatus === "submitted" || fromStatus === "hardware_review") {
    return "Parameter hardware review role is required for this project.";
  }

  return "Parameter software review role is required for this project.";
}

function requireCanReviewStage(auth: AuthContext, projectId: string | undefined, fromStatus: ParameterChangeRequestStatus) {
  if (projectId && canReviewParameterStage(auth, projectId, fromStatus)) return;

  throw new ApiError("FORBIDDEN", getReviewForbiddenMessage(fromStatus), 403);
}

function requireCanMerge(auth: AuthContext, projectId: string | undefined) {
  if (projectId && canMergeParameters(auth, projectId)) return;

  throw new ApiError("FORBIDDEN", "Parameter merge role is required for this project.", 403);
}

function getCompleteWorkflowAssignees(input: SubmitParameterChangesInput) {
  const assignees = input.assignees;
  if (!assignees) {
    return undefined;
  }

  if (!assignees?.hardwareCommitterId || !assignees.softwareCommitterId || !assignees.softwareUserId) {
    throw new ApiError("VALIDATION_FAILED", "Workflow assignees must include all review roles or be omitted.", 400);
  }

  return {
    hardwareCommitterId: assignees.hardwareCommitterId,
    softwareCommitterId: assignees.softwareCommitterId,
    softwareUserId: assignees.softwareUserId
  };
}

function assertUniqueSubmissionParameters(items: SubmitParameterChangesInput["items"]) {
  const parameterIds = new Set<string>();

  for (const item of items) {
    if (parameterIds.has(item.parameterId)) {
      throw new ApiError("VALIDATION_FAILED", "Each parameter can only appear once per submission round.", 400, {
        parameterId: item.parameterId
      });
    }

    parameterIds.add(item.parameterId);
  }
}

function assertValidCreateImportInput(input: CreateImportPreviewInput) {
  const parsed = createImportBatchBodySchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", "Invalid parameter import item.", 400, {
      issues: parsed.error.issues
    });
  }

  return parsed.data;
}

function assertValidApplyImportInput(input: ApplyImportBatchInput) {
  const parsed = applyImportBatchBodySchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", "Invalid parameter import apply request.", 400, {
      issues: parsed.error.issues
    });
  }

  if (parsed.data.selectedItemIds && parsed.data.selectedItemIds.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "At least one import item must be selected.", 400);
  }

  return parsed.data;
}

async function assertWorkflowAssigneesAreEligible(
  db: Queryable,
  auth: AuthContext,
  projectId: string,
  assignees: SubmitParameterChangesInput["assignees"]
) {
  if (!assignees) return;

  const checks = [
    { userId: assignees.hardwareCommitterId, roleId: "hardware-committer" as const },
    { userId: assignees.softwareCommitterId, roleId: "software-committer" as const },
    { userId: assignees.softwareUserId, roleId: ["software-user", "software-committer"] as const }
  ];

  for (const check of checks) {
    if (!check.userId) continue;
    const eligible = await hasEligibleWorkflowAssignee(db, {
      organizationId: auth.organization.id,
      projectId,
      userId: check.userId,
      roleId: check.roleId
    });

    if (!eligible) {
      throw new ApiError("VALIDATION_FAILED", "Workflow assignee is not eligible for the requested role.", 400, {
        userId: check.userId,
        roleId: check.roleId,
        projectId
      });
    }
  }
}

function normalizeSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || "parameter";
}

function createUniqueId(base: string, used: Set<string>) {
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function createImportDefinitionId(used: Set<string>) {
  let candidate = `import-${randomUUID()}`;
  while (used.has(candidate)) {
    candidate = `import-${randomUUID()}`;
  }
  used.add(candidate);
  return candidate;
}

function valuesMatch(left: string | undefined, right: string | undefined) {
  return (left ?? "") === (right ?? "");
}

function itemDiffers(item: ParameterImportSourceItemDto, existing: ParameterDefinitionImportCandidate) {
  return !(
    valuesMatch(item.name, existing.name) &&
    valuesMatch(item.module, existing.module) &&
    valuesMatch(item.risk, existing.risk) &&
    valuesMatch(item.unit, existing.unit) &&
    valuesMatch(item.range, existing.range) &&
    valuesMatch(item.description, existing.description) &&
    valuesMatch(item.explanation, existing.explanation) &&
    valuesMatch(item.configFormat, existing.configFormat) &&
    valuesMatch(item.currentValue, existing.currentValue) &&
    valuesMatch(item.recommendedValue, existing.recommendedValue)
  );
}

function parseNumericValue(value: string | undefined) {
  if (!value) return null;
  const numeric = Number(value.trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function hasHighRiskDelta(item: ParameterImportSourceItemDto, existing: ParameterDefinitionImportCandidate | undefined) {
  if (item.risk !== "High" || !existing) return false;

  return [
    [existing.currentValue, item.currentValue],
    [existing.recommendedValue, item.recommendedValue]
  ].some(([currentValue, nextValue]) => {
    const current = parseNumericValue(currentValue);
    const next = parseNumericValue(nextValue);
    if (current === null || next === null || current === 0) return false;

    return Math.abs(next - current) / Math.abs(current) > 0.2;
  });
}

function summarizeImportItems(items: PersistedImportBatchItem[]): ParameterImportSummaryDto {
  return items.reduce<ParameterImportSummaryDto>(
    (summary, item) => {
      summary[item.classification] += 1;
      if (item.riskFlag) summary.highRisk += 1;
      return summary;
    },
    { added: 0, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 }
  );
}

async function loadParameterForSubmission(
  db: Queryable,
  auth: AuthContext,
  projectId: string,
  parameterId: string
) {
  const parameter = await getProjectParameterForUpdate(db, {
    organizationId: auth.organization.id,
    projectId,
    parameterId
  });

  if (!parameter) {
    throw new ApiError("NOT_FOUND", "Parameter was not found for this project.", 404, { parameterId, projectId });
  }

  return parameter;
}

async function loadChangeRequestForReview(db: Queryable, auth: AuthContext, requestId: string) {
  const request = await getChangeRequestById(db, {
    organizationId: auth.organization.id,
    requestId
  });

  if (!request) {
    throw new ApiError("NOT_FOUND", "Parameter change request was not found.", 404, { requestId });
  }

  return request;
}

async function loadProjectForImport(db: Queryable, auth: AuthContext, projectId: string) {
  const project = await getProjectById(db, {
    organizationId: auth.organization.id,
    projectId
  });

  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", 404, { projectId });
  }

  return project;
}

function hasHighRiskReviewEvidence(
  decisions: Awaited<ReturnType<typeof listReviewDecisions>>
) {
  const hasHardwareDecision = decisions.some(
    (decision) =>
      decision.decision === "advance" &&
      decision.fromStatus === "hardware_review" &&
      decision.toStatus === "software_review"
  );
  const hasSoftwareDecision = decisions.some(
    (decision) =>
      decision.decision === "advance" &&
      decision.fromStatus === "software_review" &&
      decision.toStatus === "software_merge"
  );

  return hasHardwareDecision && hasSoftwareDecision;
}

async function updateRoundStatusIfNeeded(
  db: Queryable,
  auth: AuthContext,
  submissionRoundId: string | undefined
) {
  if (!submissionRoundId) return undefined;

  return updateSubmissionRoundStatusFromRequests(db, {
    organizationId: auth.organization.id,
    submissionRoundId
  });
}

async function buildReviewParticipants(
  db: Queryable,
  organizationId: string,
  request: ChangeRequestDto,
  decisions: Awaited<ReturnType<typeof listReviewDecisions>>
) {
  const userIds = new Set<string>();
  for (const decision of decisions) {
    userIds.add(decision.reviewerUserId);
  }
  if (request.workflowAssignees) {
    userIds.add(request.workflowAssignees.hardwareCommitterId);
    userIds.add(request.workflowAssignees.softwareCommitterId);
    userIds.add(request.workflowAssignees.softwareUserId);
  }
  const names = await listUserNamesByIds(db, { organizationId, userIds: [...userIds] });
  const participants: Array<{ role: string; name: string; action?: string; note?: string; time?: string }> = [
    { role: "提交人", name: request.submitter, action: "提交变更" }
  ];

  for (const decision of decisions) {
    participants.push({
      role: parameterStatusLabels[decision.fromStatus as ParameterChangeRequestStatus],
      name: names.get(decision.reviewerUserId) ?? decision.reviewerUserId,
      action: decision.decision === "advance" ? "推进流程" : "打回变更",
      note: decision.note ?? undefined,
      time: decision.createdAt
    });
  }

  return participants;
}

function buildChangeRequestAuditMetadata(
  request: ChangeRequestDto,
  input: {
    fromStatus: ParameterChangeRequestStatus;
    toStatus: ParameterChangeRequestStatus;
    note?: string;
    expectedVersion?: number;
    participants?: Array<{ role: string; name: string; action?: string; note?: string; time?: string }>;
  }
) {
  const parameterImpact = request.impact.find((item) => item.kind === "parameter");

  return {
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    note: input.note,
    expectedVersion: input.expectedVersion,
    parameterId: request.parameterId,
    parameterName: request.title,
    module: request.module,
    currentValue: request.currentValue,
    targetValue: request.targetValue,
    risk: parameterImpact?.risk,
    reason: parameterImpact?.note,
    submitter: request.submitter,
    participants: input.participants
  };
}

async function createParameterReviewAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId?: string;
    requestId: string;
    kind: "parameter-review-advance" | "parameter-review-reject" | "parameter-merge";
    action: "advance" | "reject" | "merge";
    fromStatus: ParameterChangeRequestStatus;
    toStatus: ParameterChangeRequestStatus;
    note?: string;
    expectedVersion?: number;
    changeRequest: ChangeRequestDto;
    participants?: Array<{ role: string; name: string; action?: string; note?: string; time?: string }>;
  },
  context: ServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId ?? null,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameter-management",
    kind: input.kind,
    action: input.action,
    severity: input.kind === "parameter-merge" ? "High" : "Medium",
    targetType: "parameter-change-request",
    targetId: input.requestId,
    metadata: buildChangeRequestAuditMetadata(input.changeRequest, {
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      note: input.note,
      expectedVersion: input.expectedVersion,
      participants: input.participants
    }),
    traceId: context.requestId ?? randomUUID()
  });
}

async function createImportAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string;
    batchId: string;
    summary: { added: number; updated: number; skipped: number };
    action?: "preview" | "apply";
    reviewMetadata?: CreateImportPreviewInput["reviewMetadata"];
  },
  context: ServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameter-management",
    kind: "batch-import",
    action: input.action ?? "apply",
    severity: "High",
    targetType: "parameter-import-batch",
    targetId: input.batchId,
    metadata: {
      batchId: input.batchId,
      summary: input.summary,
      ...(input.reviewMetadata ? { reviewMetadata: input.reviewMetadata } : {})
    },
    traceId: context.requestId ?? randomUUID()
  });
}

export async function createImportPreview(db: Queryable, auth: AuthContext, input: CreateImportPreviewInput) {
  requireCanAdminImport(auth);
  const parsed = assertValidCreateImportInput(input);
  await loadProjectForImport(db, auth, parsed.projectId);
  const names = parsed.items.map((item) => item.name);
  const definitionIds = parsed.items.map((item) => item.id).filter((id): id is string => Boolean(id));
  const candidates = await listParameterDefinitionsForImport(db, {
    organizationId: auth.organization.id,
    projectId: parsed.projectId,
    names,
    definitionIds
  });
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]));
  const usedItemIds = new Set<string>();
  const usedDefinitionIds = new Set(candidates.map((candidate) => candidate.id));
  const previewItems: PersistedImportBatchItem[] = [];

  for (const sourceItem of parsed.items) {
    const existing = sourceItem.id ? byId.get(sourceItem.id) : byName.get(sourceItem.name);
    const itemId = createUniqueId(sourceItem.id ?? normalizeSlug(sourceItem.name), usedItemIds);
    const definitionId = existing?.id ?? createImportDefinitionId(usedDefinitionIds);
    const projectParameterValueId = existing?.projectParameterValueId ?? `${parsed.projectId}-${definitionId}`;
    const openRequest = existing?.projectParameterValueId
      ? await findOpenChangeRequest(db, {
          organizationId: auth.organization.id,
          projectId: parsed.projectId,
          parameterId: existing.projectParameterValueId
        })
      : null;
    const classification = !existing
      ? "added"
      : openRequest
        ? "conflict"
        : itemDiffers(sourceItem, existing)
          ? "updated"
          : "unchanged";

    previewItems.push({
      id: itemId,
      name: sourceItem.name,
      module: sourceItem.module,
      risk: sourceItem.risk,
      unit: sourceItem.unit,
      range: sourceItem.range,
      currentValue: sourceItem.currentValue,
      recommendedValue: sourceItem.recommendedValue,
      description: sourceItem.description ?? "",
      explanation: sourceItem.explanation ?? "",
      configFormat: sourceItem.configFormat ?? "",
      classification,
      definitionId,
      projectParameterValueId,
      riskFlag: classification === "updated" && hasHighRiskDelta(sourceItem, existing)
    });
  }

  const summary = summarizeImportItems(previewItems);
  const batch = await insertImportBatch(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: parsed.projectId,
    createdByUserId: auth.user.id,
    sourceName: parsed.sourceName,
    summary,
    items: previewItems
  });

  if (parsed.reviewMetadata) {
    await createImportAudit(db, auth, {
      projectId: parsed.projectId,
      batchId: batch.id,
      summary: {
        added: summary.added,
        updated: summary.updated,
        skipped: parsed.reviewMetadata.skippedRows?.length ?? 0
      },
      action: "preview",
      reviewMetadata: parsed.reviewMetadata
    });
  }

  return batch;
}

export async function applyImportBatch(db: Database, auth: AuthContext, input: ApplyImportBatchInput, context: ServiceContext = {}) {
  requireCanAdminImport(auth);
  const parsed = assertValidApplyImportInput(input);

  return db.transaction(async (tx) => {
    const batch = await getImportBatchForUpdate(tx, {
      organizationId: auth.organization.id,
      batchId: parsed.batchId
    });

    if (!batch) {
      throw new ApiError("NOT_FOUND", "Parameter import batch was not found.", 404, { batchId: parsed.batchId });
    }
    if (batch.status !== "previewed") {
      throw new ApiError("CONFLICT", "Parameter import batch has already been applied.", 409, { batchId: parsed.batchId });
    }

    await loadProjectForImport(tx, auth, batch.projectId);

    if (parsed.selectedItemIds) {
      const batchItemIds = new Set(batch.items.map((item) => item.id));
      const unknownItemId = parsed.selectedItemIds.find((itemId) => !batchItemIds.has(itemId));
      if (unknownItemId) {
        throw new ApiError("VALIDATION_FAILED", "Selected import item was not found in the batch.", 400, {
          batchId: parsed.batchId,
          itemId: unknownItemId
        });
      }
    }

    const selectedIds = parsed.selectedItemIds ? new Set(parsed.selectedItemIds) : null;
    const selectedItems = batch.items.filter((item) => {
      if (!selectedIds) return item.classification === "added" || item.classification === "updated";
      return selectedIds.has(item.id) && item.classification !== "unchanged";
    });
    const conflictItem = selectedItems.find((item) => item.classification === "conflict");
    if (conflictItem) {
      throw new ApiError("CONFLICT", "Cannot apply import items with open change requests.", 409, {
        batchId: parsed.batchId,
        itemId: conflictItem.id
      });
    }
    if (selectedItems.length === 0) {
      throw new ApiError("VALIDATION_FAILED", "At least one eligible import item must be selected.", 400, {
        batchId: parsed.batchId
      });
    }

    const selectedItemsWithTargets = selectedItems.map((item) => {
      if (!item.definitionId || !item.projectParameterValueId) {
        throw new ApiError("VALIDATION_FAILED", "Import preview item is missing persisted target identifiers.", 400, {
          batchId: parsed.batchId,
          itemId: item.id
        });
      }

      return { ...item, definitionId: item.definitionId, projectParameterValueId: item.projectParameterValueId };
    });

    for (const item of selectedItemsWithTargets) {
      if (item.classification !== "updated") continue;

      await getProjectParameterForUpdate(tx, {
        organizationId: auth.organization.id,
        projectId: batch.projectId,
        parameterId: item.projectParameterValueId
      });

      const openRequest = await findOpenChangeRequest(tx, {
        organizationId: auth.organization.id,
        projectId: batch.projectId,
        parameterId: item.projectParameterValueId
      });
      if (openRequest) {
        throw new ApiError("CONFLICT", "Cannot apply import items with open change requests.", 409, {
          batchId: parsed.batchId,
          itemId: item.id,
          requestId: openRequest.id
        });
      }
    }

    let added = 0;
    let updated = 0;
    for (const item of selectedItemsWithTargets) {
      if (item.classification === "added") {
        const appliedItem = await applyAddedImportItem(tx, {
          organizationId: auth.organization.id,
          projectId: batch.projectId,
          actorUserId: auth.user.id,
          historyId: randomUUID(),
          item
        });
        if (!appliedItem) {
          throw new ApiError("CONFLICT", "Import item definition id already exists.", 409, {
            batchId: parsed.batchId,
            itemId: item.id,
            definitionId: item.definitionId
          });
        }
        added += 1;
      } else if (item.classification === "updated") {
        const appliedItem = await applyUpdatedImportItem(tx, {
          organizationId: auth.organization.id,
          projectId: batch.projectId,
          actorUserId: auth.user.id,
          historyId: randomUUID(),
          item
        });
        if (!appliedItem) {
          throw new ApiError("CONFLICT", "Import item definition id already exists.", 409, {
            batchId: parsed.batchId,
            itemId: item.id,
            definitionId: item.definitionId
          });
        }
        updated += 1;
      }
    }

    const applied = await markImportBatchApplied(tx, {
      organizationId: auth.organization.id,
      batchId: parsed.batchId
    });
    if (!applied) {
      throw new ApiError("NOT_FOUND", "Parameter import batch was not found.", 404, { batchId: parsed.batchId });
    }

    await createImportAudit(tx, auth, {
      projectId: batch.projectId,
      batchId: batch.id,
      summary: {
        added,
        updated,
        skipped: batch.items.length - selectedItems.length
      },
      reviewMetadata: parsed.reviewMetadata
    }, context);

    const project = await getProjectById(tx, {
      organizationId: auth.organization.id,
      projectId: batch.projectId
    });
    await notifyParameterImportCompleted(tx, {
      organizationId: auth.organization.id,
      projectId: batch.projectId,
      projectName: project?.name,
      batchId: batch.id,
      recipientUserId: auth.user.id,
      added,
      updated
    });

    return applied;
  });
}

export async function saveDraft(db: Queryable, auth: AuthContext, input: SaveDraftInput) {
  requireCanEdit(auth);
  await loadParameterForSubmission(db, auth, input.projectId, input.parameterId);

  const bindingId = input.projectParameterBindingId ?? input.parameterId;
  let writeLock;
  if (await mustUseSemanticParameterIdentity(db)) {
    writeLock = await resolveBindingWriteLock(db, auth, { bindingId });
  }

  return upsertDraft(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    parameterId: input.parameterId,
    userId: auth.user.id,
    targetValue: input.targetValue,
    reason: input.reason,
    origin: "manual",
    projectParameterBindingId: input.projectParameterBindingId,
    parameterSpecId: input.parameterSpecId,
    writeLock,
  });
}

export async function deleteDraft(db: Queryable, auth: AuthContext, draftId: string) {
  requireCanEdit(auth);

  await deleteDraftRow(db, {
    organizationId: auth.organization.id,
    userId: auth.user.id,
    draftId
  });
}

export async function submitParameterChanges(db: Database, auth: AuthContext, input: SubmitParameterChangesInput, context: ServiceContext = {}) {
  requireCanEdit(auth);

  if (input.items.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "At least one parameter change is required.", 400);
  }
  assertUniqueSubmissionParameters(input.items);
  const workflowAssignees = getCompleteWorkflowAssignees(input);

  return db.transaction(async (tx) => {
    const parameters = [];
    for (const item of input.items) {
      const parameter = await loadParameterForSubmission(tx, auth, input.projectId, item.parameterId);
      const openRequest = await findOpenChangeRequest(tx, {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        parameterId: item.parameterId
      });

      if (openRequest) {
        throw new ApiError("CONFLICT", "Parameter already has an open change request.", 409, {
          parameterId: item.parameterId,
          requestId: openRequest.id
        });
      }
      const hasConflict = await hasOpenFileSyncConflict(tx, {
        projectParameterValueId: parameter.id
      });
      if (hasConflict) {
        throw new ApiError("CONFLICT", "Parameter has an open file sync conflict.", 409, {
          parameterId: item.parameterId
        });
      }

      if (parameter.sourceNodePath) {
        await assertSensitiveNodeWriteAllowed(tx, auth, {
          organizationId: auth.organization.id,
          projectId: input.projectId,
          nodePath: parameter.sourceNodePath,
          sourceFileName: parameter.sourceFileName,
          actorType: context.actorType ?? "user",
          requestId: context.requestId
        });
      }

      parameters.push({ item, parameter });
    }

    await assertWorkflowAssigneesAreEligible(tx, auth, input.projectId, workflowAssignees);

    const status = workflowAssignees ? "hardware_review" : "submitted";
    const round = await createSubmissionRound(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      projectId: input.projectId,
      submitterUserId: auth.user.id,
      status,
      summary: input.reason?.trim() || "Parameter changes submitted."
    });

    const items = [];
    for (const { item, parameter } of parameters) {
      const useSemanticIdentity = await mustUseSemanticParameterIdentity(tx);
      const draftIdentity = await tx.query<{
        project_parameter_binding_id: string | null;
      }>(
        useSemanticIdentity
          ? `
        select project_parameter_binding_id
        from parameter_drafts
        where organization_id = $1
          and project_id = $2
          and project_parameter_binding_id = $3
          and user_id = $4
        limit 1
        `
          : `
        select project_parameter_binding_id
        from parameter_drafts
        where organization_id = $1
          and project_id = $2
          and project_parameter_value_id = $3
          and user_id = $4
        limit 1
        `,
        [auth.organization.id, input.projectId, parameter.id, auth.user.id]
      );
      const projectParameterBindingId =
        item.projectParameterBindingId ?? draftIdentity.rows[0]?.project_parameter_binding_id ?? undefined;
      let parameterSpecId = item.parameterSpecId;
      if (!parameterSpecId && projectParameterBindingId) {
        const bindingSpec = await tx.query<{ parameter_spec_id: string }>(
          `select parameter_spec_id from project_parameter_bindings where id = $1 limit 1`,
          [projectParameterBindingId]
        );
        parameterSpecId = bindingSpec.rows[0]?.parameter_spec_id;
      }

      const writeLock =
        projectParameterBindingId && (await mustUseSemanticParameterIdentity(tx))
          ? await getDraftWriteLock(tx, {
              organizationId: auth.organization.id,
              projectId: input.projectId,
              bindingId: projectParameterBindingId,
              userId: auth.user.id,
            })
          : null;
      if (projectParameterBindingId && (await mustUseSemanticParameterIdentity(tx)) && !writeLock) {
        throw new ApiError("CONFLICT", "Draft is missing exact writeback lock metadata.", 409, {
          parameterId: parameter.id,
        });
      }

      const request = await createChangeRequest(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        submissionRoundId: round.id,
        projectId: input.projectId,
        parameterId: parameter.id,
        parameterDefinitionId: parameter.parameterDefinitionId,
        baseVersion: parameter.valueVersion,
        currentValue: parameter.currentValue,
        targetValue: item.targetValue,
        status,
        submitterUserId: auth.user.id,
        assignedToUserId: workflowAssignees?.hardwareCommitterId,
        workflowAssignees,
        parameterSpecId,
        projectParameterBindingId,
        writeLock: writeLock ?? undefined,
      });

      const submissionItem = await createSubmissionItem(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        submissionRoundId: round.id,
        changeRequestId: request.id,
        parameterId: parameter.id,
        currentValue: parameter.currentValue,
        targetValue: item.targetValue,
        reason: item.reason,
        projectParameterBindingId
      });

      await deleteDraftForParameter(tx, {
        organizationId: auth.organization.id,
        userId: auth.user.id,
        projectId: input.projectId,
        parameterId: parameter.id
      });

      items.push(submissionItem);
    }

    await createAuditEvent(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      projectId: input.projectId,
      actorUserId: auth.user.id,
      actorType: "user",
      app: "parameter-management",
      kind: "parameter-submit",
      action: "submit",
      severity: "Medium",
      targetType: "parameter-submission-round",
      targetId: round.id,
      metadata: {
        itemCount: items.length,
        status
      },
      traceId: context.requestId ?? randomUUID()
    });

    if (workflowAssignees?.hardwareCommitterId) {
      const project = await getProjectById(tx, {
        organizationId: auth.organization.id,
        projectId: input.projectId
      });
      await notifyParameterReviewSubmitted(tx, {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        projectName: project?.name,
        roundId: round.id,
        itemCount: items.length,
        submitterName: auth.user.name,
        reviewerUserIds: [workflowAssignees.hardwareCommitterId]
      });
    }

    return workflowAssignees ? { ...round, workflowAssignees, items } : { ...round, items };
  });
}

export async function listDrafts(db: Queryable, auth: AuthContext, query: DraftListQuery = {}) {
  requireCanView(auth);

  return listDraftsForUser(db, {
    organizationId: auth.organization.id,
    userId: auth.user.id,
    projectId: query.projectId
  });
}

export async function listSubmissionRounds(db: Queryable, auth: AuthContext, query: SubmissionRoundListQuery = {}) {
  requireCanView(auth);

  const organizationId = auth.organization.id;
  const rounds = await listSubmissionRoundRows(db, {
    organizationId,
    projectId: query.projectId,
    status: query.status
  });

  if (rounds.length === 0) {
    return rounds;
  }

  const requestIds = [...new Set(rounds.flatMap((round) => round.items.map((item) => item.requestId)))];
  const [decisions, workflowStates] = await Promise.all([
    listReviewDecisionsForRequestIds(db, { organizationId, requestIds }),
    listChangeRequestWorkflowStateByIds(db, { organizationId, requestIds })
  ]);

  const userIds = new Set<string>();
  for (const round of rounds) {
    if (round.workflowAssignees) {
      userIds.add(round.workflowAssignees.hardwareCommitterId);
      userIds.add(round.workflowAssignees.softwareCommitterId);
      userIds.add(round.workflowAssignees.softwareUserId);
    }
  }
  for (const decision of decisions) {
    userIds.add(decision.reviewerUserId);
  }
  for (const request of workflowStates) {
    if (request.assignedTo) {
      userIds.add(request.assignedTo);
    }
  }

  const userNames = await listUserNamesByIds(db, { organizationId, userIds: [...userIds] });
  const resolveUserName = (userId?: string) => {
    if (!userId) {
      return "未指派";
    }
    return userNames.get(userId) ?? userId;
  };

  const workflowStateByRequestId = new Map(workflowStates.map((request) => [request.id, request]));

  return rounds.map((round) => {
    const roundRequestIds = round.items.map((item) => item.requestId);
    const roundDecisions = decisions.filter((decision) => roundRequestIds.includes(decision.requestId));
    const timelineRound = {
      ...round,
      status: parameterStatusLabels[round.status]
    };
    const { activeIndex } = deriveSubmissionTimeline(timelineRound);

    const workflowTrail = buildSubmissionWorkflowTrail({
      activeIndex,
      workflowAssignees: round.workflowAssignees,
      requestIds: roundRequestIds,
      changeRequests: roundRequestIds.flatMap((requestId) => {
        const request = workflowStateByRequestId.get(requestId);
        if (!request) {
          return [];
        }

        return [
          {
            id: request.id,
            assignedTo: request.assignedTo,
            status: parameterStatusLabels[request.status as ParameterChangeRequestStatus] as (typeof timelineRound)["status"]
          }
        ];
      }),
      reviewDecisions: roundDecisions.map((decision) => ({
        id: decision.id,
        requestId: decision.requestId,
        reviewerUserId: decision.reviewerUserId,
        decision: decision.decision,
        fromStatus: decision.fromStatus,
        toStatus: decision.toStatus,
        createdAt: decision.createdAt
      })),
      resolveUserName
    });

    return {
      ...round,
      workflowTrail
    };
  });
}

export async function listChangeRequests(db: Queryable, auth: AuthContext, query: ChangeRequestListQuery = {}) {
  requireCanView(auth);

  return listChangeRequestRows(db, {
    organizationId: auth.organization.id,
    projectId: query.projectId,
    status: query.status,
    assignedTo: query.assignedTo
  });
}

const nonWithdrawableSubmissionRoundStatuses = new Set<ParameterSubmissionRoundStatus>([
  "merged",
  "rejected",
  "withdrawn",
  "stashed"
]);

export async function withdrawSubmissionRound(
  db: Database,
  auth: AuthContext,
  roundId: string,
  context: ServiceContext = {}
) {
  requireCanEdit(auth);

  return db.transaction(async (tx) => {
    const owner = await getSubmissionRoundSubmitterUserId(tx, {
      organizationId: auth.organization.id,
      roundId
    });

    if (!owner) {
      throw new ApiError("NOT_FOUND", "Parameter submission round was not found.", 404, { roundId });
    }

    if (owner.submitter_user_id !== auth.user.id) {
      throw new ApiError("FORBIDDEN", "Only the submitter can withdraw this submission round.", 403, { roundId });
    }

    if (nonWithdrawableSubmissionRoundStatuses.has(owner.status)) {
      throw new ApiError("CONFLICT", "Parameter submission round is already closed.", 409, {
        roundId,
        status: owner.status
      });
    }

    const round = await getSubmissionRoundById(tx, {
      organizationId: auth.organization.id,
      roundId
    });

    if (!round) {
      throw new ApiError("NOT_FOUND", "Parameter submission round was not found.", 404, { roundId });
    }

    await withdrawOpenChangeRequestsForRound(tx, {
      organizationId: auth.organization.id,
      roundId,
      note: "提交人已撤回本轮提交。"
    });

    await updateSubmissionRoundStatus(tx, {
      organizationId: auth.organization.id,
      roundId,
      status: "withdrawn",
      summary: `${round.summary} 已由提交人撤回。`
    });

    await createAuditEvent(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      projectId: round.projectId,
      actorUserId: auth.user.id,
      actorType: "user",
      app: "parameter-management",
      kind: "parameter-submission-withdraw",
      action: "withdraw",
      severity: "Medium",
      targetType: "parameter-submission-round",
      targetId: roundId,
      metadata: {
        itemCount: round.items.length
      },
      traceId: context.requestId ?? randomUUID()
    });

    const updated = await getSubmissionRoundById(tx, {
      organizationId: auth.organization.id,
      roundId
    });

    if (!updated) {
      throw new ApiError("NOT_FOUND", "Parameter submission round was not found.", 404, { roundId });
    }

    return updated;
  });
}

export async function reviewChange(db: Database, auth: AuthContext, input: ReviewParameterChangeInput, context: ServiceContext = {}) {
  return db.transaction(async (tx) => {
    const request = await loadChangeRequestForReview(tx, auth, input.requestId);
    const fromStatus = request.status;

    if (fromStatus === "merged" || fromStatus === "rejected") {
      throw new ApiError("CONFLICT", "Parameter change request is already closed.", 409, {
        requestId: input.requestId,
        status: fromStatus
      });
    }

    if (input.decision === "reject") {
      requireCanReviewStage(auth, request.projectId, fromStatus);
      const toStatus = "rejected";
      const updated = await updateChangeRequestStatus(tx, {
        organizationId: auth.organization.id,
        requestId: input.requestId,
        status: toStatus,
        note: input.note
      });

      if (!updated) {
        throw new ApiError("NOT_FOUND", "Parameter change request was not found.", 404, { requestId: input.requestId });
      }

      await insertReviewDecision(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        requestId: input.requestId,
        reviewerUserId: auth.user.id,
        decision: "reject",
        fromStatus,
        toStatus,
        note: input.note
      });
      await updateRoundStatusIfNeeded(tx, auth, request.submissionRoundId);
      await createParameterReviewAudit(tx, auth, {
        projectId: request.projectId,
        requestId: input.requestId,
        kind: "parameter-review-reject",
        action: "reject",
        fromStatus,
        toStatus,
        note: input.note,
        changeRequest: request,
        participants: [
          { role: "提交人", name: request.submitter, action: "提交变更" },
          {
            role: parameterStatusLabels[fromStatus],
            name: auth.user.name,
            action: "打回变更",
            note: input.note
          }
        ]
      }, context);

      if (request.submitterUserId && request.projectId) {
        const project = await getProjectById(tx, {
          organizationId: auth.organization.id,
          projectId: request.projectId
        });
        await notifyParameterReviewRejected(tx, {
          organizationId: auth.organization.id,
          projectId: request.projectId,
          projectName: project?.name,
          requestId: input.requestId,
          parameterName: request.title,
          submitterUserId: request.submitterUserId,
          reviewerName: auth.user.name,
          note: input.note
        });
      }

      return updated;
    }

    const requestRisk = request.impact.find((item) => item.kind === "parameter")?.risk;
    const toStatus = getNextParameterStatus(fromStatus, requestRisk);
    if (fromStatus !== "software_merge") {
      requireCanReviewStage(auth, request.projectId, fromStatus);

      if (toStatus === fromStatus) {
        throw new ApiError("CONFLICT", "Parameter change request cannot advance from its current status.", 409, {
          requestId: input.requestId,
          status: fromStatus
        });
      }

      const updated = await updateChangeRequestStatus(tx, {
        organizationId: auth.organization.id,
        requestId: input.requestId,
        status: toStatus,
        note: input.note
      });

      if (!updated) {
        throw new ApiError("NOT_FOUND", "Parameter change request was not found.", 404, { requestId: input.requestId });
      }

      await insertReviewDecision(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        requestId: input.requestId,
        reviewerUserId: auth.user.id,
        decision: "advance",
        fromStatus,
        toStatus,
        note: input.note
      });
      await updateRoundStatusIfNeeded(tx, auth, request.submissionRoundId);
      await createParameterReviewAudit(tx, auth, {
        projectId: request.projectId,
        requestId: input.requestId,
        kind: "parameter-review-advance",
        action: "advance",
        fromStatus,
        toStatus,
        note: input.note,
        changeRequest: request,
        participants: [
          { role: "提交人", name: request.submitter, action: "提交变更" },
          {
            role: parameterStatusLabels[fromStatus],
            name: auth.user.name,
            action: "推进审阅",
            note: input.note
          }
        ]
      }, context);

      if (request.submitterUserId && request.projectId) {
        const project = await getProjectById(tx, {
          organizationId: auth.organization.id,
          projectId: request.projectId
        });
        const assigneeUserIds =
          updated.assignedTo && updated.assignedTo !== request.submitterUserId ? [updated.assignedTo] : [];
        await notifyParameterReviewAdvanced(tx, {
          organizationId: auth.organization.id,
          projectId: request.projectId,
          projectName: project?.name,
          requestId: input.requestId,
          parameterName: request.title,
          submitterUserId: request.submitterUserId,
          reviewerName: auth.user.name,
          toStatus: parameterStatusLabels[toStatus] ?? toStatus,
          assigneeUserIds
        });
      }

      return updated;
    }

    requireCanMerge(auth, request.projectId);

    let reviewDecisions: Awaited<ReturnType<typeof listReviewDecisions>> = [];
    if (request.impact.some((item) => item.kind === "parameter" && item.risk === "High")) {
      reviewDecisions = await listReviewDecisions(tx, {
        organizationId: auth.organization.id,
        requestId: input.requestId
      });

      if (!hasHighRiskReviewEvidence(reviewDecisions)) {
        throw new ApiError(
          "CONFLICT",
          "High-risk parameter changes require hardware and software review before merge.",
          409,
          { requestId: input.requestId }
        );
      }
    } else {
      reviewDecisions = await listReviewDecisions(tx, {
        organizationId: auth.organization.id,
        requestId: input.requestId
      });
    }

    const participants = await buildReviewParticipants(tx, auth.organization.id, request, reviewDecisions);
    participants.push({
      role: "合入执行",
      name: auth.user.name,
      action: "合入参数",
      note: input.note
    });

    const merged = await mergeChangeRequest(tx, {
      historyId: randomUUID(),
      organizationId: auth.organization.id,
      requestId: input.requestId,
      expectedVersion: input.expectedVersion,
      actorUserId: auth.user.id
    });

    if (!merged) {
      throw new ApiError("CONFLICT", "Parameter value changed before merge.", 409, { requestId: input.requestId });
    }

    const updated = await updateChangeRequestStatus(tx, {
      organizationId: auth.organization.id,
      requestId: input.requestId,
      status: "merged",
      note: input.note
    });

    if (!updated) {
      throw new ApiError("NOT_FOUND", "Parameter change request was not found.", 404, { requestId: input.requestId });
    }

    await insertReviewDecision(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      requestId: input.requestId,
      reviewerUserId: auth.user.id,
      decision: "advance",
      fromStatus,
      toStatus: "merged",
      note: input.note
    });
    await updateRoundStatusIfNeeded(tx, auth, request.submissionRoundId);
    await createParameterReviewAudit(tx, auth, {
      projectId: request.projectId,
      requestId: input.requestId,
      kind: "parameter-merge",
      action: "merge",
      fromStatus,
      toStatus: "merged",
      note: input.note,
      expectedVersion: input.expectedVersion,
      changeRequest: request,
      participants
    }, context);
    if (context.objectStore && request.projectId) {
      await writebackMergedParameterValue(
        tx,
        context.objectStore,
        auth,
        {
          projectId: request.projectId,
          parameterDefinitionId: merged.parameterDefinitionId,
          mergedValue: merged.targetValue,
          projectParameterBindingId: merged.projectParameterBindingId,
          parameterSpecId: merged.parameterSpecId,
          changeRequestId: input.requestId,
        },
        {
          ...context,
          skipToolchain: process.env.WISEEFF_WRITEBACK_SKIP_TOOLCHAIN === "1",
        }
      );
    }

    if (request.submitterUserId && request.projectId) {
      const project = await getProjectById(tx, {
        organizationId: auth.organization.id,
        projectId: request.projectId
      });
      await notifyParameterMergeCompleted(tx, {
        organizationId: auth.organization.id,
        projectId: request.projectId,
        projectName: project?.name,
        requestId: input.requestId,
        parameterName: request.title,
        submitterUserId: request.submitterUserId,
        mergerName: auth.user.name,
        reviewerUserIds: reviewDecisions.map((decision) => decision.reviewerUserId)
      });
    }

    return updated;
  });
}

function requireParameterAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.", 403);
  }
}

async function createParameterModuleAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    kind: "parameter-module-admin-create" | "parameter-module-admin-update" | "parameter-module-admin-move" | "parameter-module-admin-delete";
    action: "create" | "update" | "move" | "delete";
    module: Pick<ParameterModuleDto, "id" | "name" | "path" | "parentId">;
    metadata?: Record<string, unknown>;
  },
  context: ServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: null,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameter-management",
    kind: input.kind,
    action: input.action,
    severity: "Low",
    targetType: "parameter-module",
    targetId: input.module.id,
    metadata: {
      name: input.module.name,
      path: input.module.path,
      parentId: input.module.parentId,
      ...input.metadata
    },
    traceId: context.requestId ?? randomUUID()
  });
}

export async function resolveParameterListQuery(
  db: Queryable,
  organizationId: string,
  query: ListParametersQuery
): Promise<RepositoryListParametersQuery> {
  const includeDescendants = query.includeDescendants !== false;

  if (query.moduleId) {
    return {
      organizationId,
      projectId: query.projectId,
      moduleId: query.moduleId,
      includeDescendants,
      risk: query.risk,
      q: query.q,
      limit: query.limit
    };
  }

  if (query.module) {
    const resolved = await getParameterModuleByName(db, {
      organizationId,
      name: query.module.trim(),
      parentId: null
    });
    if (resolved) {
      return {
        organizationId,
        projectId: query.projectId,
        moduleId: resolved.id,
        includeDescendants,
        risk: query.risk,
        q: query.q,
        limit: query.limit
      };
    }

    return {
      organizationId,
      projectId: query.projectId,
      module: query.module,
      includeDescendants,
      risk: query.risk,
      q: query.q,
      limit: query.limit
    };
  }

  return {
    organizationId,
    projectId: query.projectId,
    risk: query.risk,
    q: query.q,
    limit: query.limit
  };
}

export async function listParameterModulesForAuth(db: Database, auth: AuthContext): Promise<ParameterModuleDto[]> {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
  }

  return listParameterModules(db, { organizationId: auth.organization.id });
}

export async function createParameterModuleForAuth(
  db: Database,
  auth: AuthContext,
  body: CreateParameterModuleBody,
  context: ServiceContext = {}
): Promise<ParameterModuleDto> {
  requireParameterAdmin(auth);
  const organizationId = auth.organization.id;
  const name = body.name.trim();
  const parentId = body.parentId ?? null;

  if (parentId) {
    const parent = await getParameterModuleById(db, { organizationId, moduleId: parentId });
    if (!parent) {
      throw new ApiError("NOT_FOUND", "Parent parameter module was not found.", 404, { parentId });
    }
  }

  const existing = await getParameterModuleByName(db, { organizationId, name, parentId });
  if (existing) {
    throw new ApiError("CONFLICT", "Parameter module already exists under this parent.", 409, { name, parentId });
  }

  return db.transaction(async (tx) => {
    const module = await createParameterModule(tx, {
      organizationId,
      name,
      parentId,
      description: body.description?.trim(),
      scope: body.scope?.trim(),
      sortOrder: body.sortOrder
    });

    await createParameterModuleAudit(
      tx,
      auth,
      {
        kind: "parameter-module-admin-create",
        action: "create",
        module
      },
      context
    );

    return module;
  });
}

export async function updateParameterModuleForAuth(
  db: Database,
  auth: AuthContext,
  moduleId: string,
  body: UpdateParameterModuleBody,
  context: ServiceContext = {}
): Promise<ParameterModuleDto> {
  requireParameterAdmin(auth);
  const organizationId = auth.organization.id;
  const current = await getParameterModuleById(db, { organizationId, moduleId });
  if (!current) {
    throw new ApiError("NOT_FOUND", "Parameter module was not found.", 404, { moduleId });
  }

  const nextName = body.name?.trim() ?? current.name;
  if (!nextName) {
    throw new ApiError("VALIDATION_FAILED", "Module name is required.", 400);
  }

  if (nextName !== current.name) {
    const conflict = await getParameterModuleByName(db, {
      organizationId,
      name: nextName,
      parentId: current.parentId
    });
    if (conflict && conflict.id !== current.id) {
      throw new ApiError("CONFLICT", "Parameter module already exists under this parent.", 409, {
        name: nextName,
        parentId: current.parentId
      });
    }
  }

  return db.transaction(async (tx) => {
    const module = await updateParameterModule(tx, {
      organizationId,
      moduleId,
      name: body.name?.trim(),
      description: body.description?.trim(),
      scope: body.scope?.trim(),
      sortOrder: body.sortOrder
    });
    if (!module) {
      throw new ApiError("NOT_FOUND", "Parameter module was not found.", 404, { moduleId });
    }

    await createParameterModuleAudit(
      tx,
      auth,
      {
        kind: "parameter-module-admin-update",
        action: "update",
        module,
        metadata: { previousName: current.name }
      },
      context
    );

    return module;
  });
}

export async function moveParameterModuleForAuth(
  db: Database,
  auth: AuthContext,
  moduleId: string,
  body: MoveParameterModuleBody,
  context: ServiceContext = {}
): Promise<ParameterModuleDto> {
  requireParameterAdmin(auth);
  const organizationId = auth.organization.id;
  const current = await getParameterModuleById(db, { organizationId, moduleId });
  if (!current) {
    throw new ApiError("NOT_FOUND", "Parameter module was not found.", 404, { moduleId });
  }

  const parentId = body.parentId;
  if (parentId) {
    const parent = await getParameterModuleById(db, { organizationId, moduleId: parentId });
    if (!parent) {
      throw new ApiError("NOT_FOUND", "Target parent parameter module was not found.", 404, { parentId });
    }
  }

  if (parentId === current.parentId) {
    return current;
  }

  const nextName = current.name;
  const conflict = await getParameterModuleByName(db, { organizationId, name: nextName, parentId });
  if (conflict && conflict.id !== current.id) {
    throw new ApiError("CONFLICT", "Parameter module already exists under the target parent.", 409, {
      name: nextName,
      parentId
    });
  }

  try {
    return await db.transaction(async (tx) => {
      const module = await moveParameterModule(tx, {
        organizationId,
        moduleId,
        parentId
      });
      if (!module) {
        throw new ApiError("NOT_FOUND", "Parameter module was not found.", 404, { moduleId });
      }

      await createParameterModuleAudit(
        tx,
        auth,
        {
          kind: "parameter-module-admin-move",
          action: "move",
          module,
          metadata: { previousParentId: current.parentId }
        },
        context
      );

      return module;
    });
  } catch (error) {
    if (error instanceof Error && /cycle/i.test(error.message)) {
      throw new ApiError("CONFLICT", error.message, 409, { moduleId, parentId });
    }
    throw error;
  }
}

export async function deleteParameterModuleForAuth(
  db: Database,
  auth: AuthContext,
  moduleId: string,
  context: ServiceContext = {}
): Promise<void> {
  requireParameterAdmin(auth);
  const organizationId = auth.organization.id;
  const current = await getParameterModuleById(db, { organizationId, moduleId });
  if (!current) {
    throw new ApiError("NOT_FOUND", "Parameter module was not found.", 404, { moduleId });
  }

  const childCount = await countParameterModuleChildren(db, { organizationId, moduleId });
  if (childCount > 0) {
    throw new ApiError("CONFLICT", "Cannot delete a parameter module that still has child modules.", 409, {
      moduleId,
      childCount
    });
  }

  const parameterCount = await countParametersForModule(db, { organizationId, moduleId });
  if (parameterCount > 0) {
    throw new ApiError("CONFLICT", "Cannot delete a parameter module referenced by parameters.", 409, {
      moduleId,
      parameterCount
    });
  }

  await db.transaction(async (tx) => {
    const deleted = await deleteParameterModule(tx, { organizationId, moduleId });
    if (!deleted) {
      throw new ApiError("NOT_FOUND", "Parameter module was not found.", 404, { moduleId });
    }

    await createParameterModuleAudit(
      tx,
      auth,
      {
        kind: "parameter-module-admin-delete",
        action: "delete",
        module: current
      },
      context
    );
  });
}
