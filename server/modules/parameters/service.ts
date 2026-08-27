import { randomUUID } from "node:crypto";

import {
  asAuditTx,
  withAuditedWrite,
  writeAuditEventInTx,
  writeTrustedAuditEventInTx,
  type AuditTx,
  type AuditedWriteContext
} from "../audit/auditedWrite";
import {
  notifyParameterImportCompleted,
  notifyParameterMergeCompleted,
  notifyParameterReviewAdvanced,
  notifyParameterReviewRejected,
  notifyParameterReviewSubmitted
} from "../notifications/producers";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import {
  assertTrustedInvocationContext,
  trustedDomainAttribution,
  trustedExecutionLabel,
  TrustedInvocationContextError,
  type TrustedInvocationContext
} from "../auth/trustedInvocation";
import {
  assertTrustedRefusalAuditSink,
  type TrustedRefusalAuditSink
} from "../audit/trustedRefusalSink";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { nodePathToParameterIdentity } from "./pathMapper";
import { getProjectParameterFileById } from "../parameter-files/repository";
import {
  preflightMergedEnablementWriteback,
  preflightMergedParameterWriteback,
  writebackMergedEnablementValue,
  writebackMergedParameterValue,
  type WritebackServiceContext
} from "../parameter-files/writebackService";
import { resolveInitializationSuggestion } from "../parameter-topology/editService";
import {
  loadLogicalNodeEnablementContext,
  loadLogicalNodeSubmissionContext,
  verifyBindingWriteLock,
  verifyEnablementWriteLock
} from "../parameter-topology/writeLock";
import { assertProjectAllowsParameterSubmit } from "./initializationService";
import { canAdminParameters, canEditParameters, canMergeParameters, canReviewParameterStage, canViewParameters } from "../parameter-kernel/policy";
import { isValidMergeLink } from "./mergeLink";
import {
  assertTrustedSensitiveNodeWriteContext,
  assertTrustedSensitiveNodeSubmissionAllowed
} from "../parameter-kernel/sensitiveNode";
import type { TrustedSensitiveNodeWriteContext } from "../parameter-kernel/sensitiveNode";
import { parameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import type { InitializationSuggestionDto } from "./types";
import {
  bindParameterSource,
  findProjectValueBySource,
  getProjectParameterForUpdate,
  insertProjectParameterValueWithSource,
  type ProjectParameterValueMatch,
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
  deleteDraft as deleteDraftRow,
  deleteDraftForParameter,
  getBindingDraftForSubmission,
  getEnablementDraftForSubmission,
  getDraftWriteLock,
  listDraftsForUser,
  promoteBindingDraftCandidateForReview,
  upsertDraft
} from "../parameter-drafts/repository";
import { hasOpenFileSyncConflict } from "./fileSyncConflictRepository";
import {
  applyAddedImportItem,
  applyUpdatedImportItem,
  getImportBatchForUpdate,
  insertImportBatch,
  listParameterDefinitionsForImport,
  markImportBatchApplied,
  type ParameterDefinitionImportCandidate,
  type PersistedImportBatchItem
} from "./importBatchRepository";
import { getProjectById } from "../projects/repository";
import {
  createChangeRequest,
  createEnablementChangeRequest,
  createEnablementSubmissionItem,
  createSubmissionItem,
  createSubmissionRound,
  findOpenChangeRequest,
  findOpenEnablementChangeRequest,
  getChangeRequestById,
  getSubmissionRoundById,
  getSubmissionRoundSubmitterUserId,
  hasEligibleWorkflowAssignee,
  insertReviewDecision,
  listEligibleWorkflowAssignees,
  listChangeRequests as listChangeRequestRows,
  listReviewDecisions,
  listReviewDecisionsForRequestIds,
  listChangeRequestWorkflowStateByIds,
  listUserNamesByIds,
  listSubmissionRounds as listSubmissionRoundRows,
  mergeChangeRequest,
  updateChangeRequestStatus,
  updateSubmissionRoundStatus,
  updateSubmissionRoundStatusFromRequests,
  withdrawOpenChangeRequestsForRound
} from "./reviewWorkflowRepository";
import { resolveSemanticMergeSubject } from "./reviewChangePolicy";
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
import { getNextParameterStatus, parameterStatusLabels, type ParameterSubmissionRoundStatus } from "./status";
import type { ParameterChangeRequestStatus } from "../parameter-kernel/workflowStatus";
import type { ParameterChangeAction } from "../parameter-drafts/types";
import type { ChangeRequestDto, ParameterImportSourceItemDto, ParameterImportSummaryDto, ParameterModuleDto } from "./types";
import { buildSubmissionWorkflowTrail } from "../../../src/domain/parameters/submissionWorkflowTrail";
import { deriveSubmissionTimeline } from "../../../src/parameterSubmissionTimeline";

type ServiceContext = AuditCorrelationContext & {
  objectStore?: ObjectStore;
  /**
   * Test-only: inject a fake DTC toolchain runner for semantic merge writeback.
   * Production routes must omit this so writeback uses the pinned host runner.
   * There is no environment-variable bypass.
   */
  toolchain?: WritebackServiceContext["toolchain"];
  /** Test-only: skip semantic promotion gates after resolve/toolchain. */
  skipSemanticGates?: boolean;
};

export type ParameterReviewContext = ServiceContext & Partial<TrustedSensitiveNodeWriteContext>;

export type ParameterSubmissionContext = ServiceContext & {
  invocation: TrustedInvocationContext;
  requestId: string;
  refusalSink: TrustedRefusalAuditSink;
};

function assertParameterSubmissionContext(
  auth: AuthContext,
  context: ParameterSubmissionContext | undefined
): ParameterSubmissionContext {
  if (!context || typeof context.requestId !== "string" || context.requestId.trim().length === 0) {
    throw new TrustedInvocationContextError(
      "parameter submission requires a requestId, server-owned refusal audit sink, and trusted invocation context"
    );
  }
  assertTrustedRefusalAuditSink(context.refusalSink);
  const invocation = assertTrustedInvocationContext(context.invocation);
  if (
    invocation.initiator !== "system" &&
    (invocation.principal.user.id !== auth.user.id ||
      invocation.principal.organization.id !== auth.organization.id ||
      invocation.principal.user.organizationId !== auth.organization.id)
  ) {
    throw new TrustedInvocationContextError(
      "parameter submission invocation principal does not match the authenticated principal"
    );
  }
  return { ...context, invocation, requestId: context.requestId.trim() };
}

export type SaveDraftInput = {
  projectId: string;
  parameterId: string;
  targetValue: string;
  reason: string;
};

export type SubmitParameterChangesInput = {
  projectId: string;
  items: Array<
    | {
        parameterId: string;
        targetValue: string;
        reason: string;
        /** Internal structured-edit compatibility; not accepted by the legacy HTTP item schema. */
        projectParameterBindingId?: string;
        parameterSpecId?: string;
      }
    | {
        draftId: string;
        editSubjectKind?: "binding";
        projectParameterBindingId: string;
        parameterSpecId: string;
        action?: ParameterChangeAction;
        targetValue: string;
        reason: string;
      }
    | {
        draftId: string;
        editSubjectKind: "node-enablement";
        logicalNodeId: string;
        action?: ParameterChangeAction;
        targetValue: string;
        reason: string;
      }
  >;
  reason?: string;
  assignees?: {
    hardwareCommitterId?: string;
    softwareCommitterId?: string;
    softwareUserId?: string;
  };
};

type EnablementSubmissionItem = Extract<
  SubmitParameterChangesInput["items"][number],
  { logicalNodeId: string }
>;

function isEnablementSubmissionItem(
  item: SubmitParameterChangesInput["items"][number]
): item is EnablementSubmissionItem {
  return (
    "draftId" in item &&
    (("editSubjectKind" in item && item.editSubjectKind === "node-enablement") ||
      ("logicalNodeId" in item && !("projectParameterBindingId" in item)))
  );
}

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
    throw new ApiError("NOT_FOUND", "Project parameter file was not found.", {
      fileId: edit.fileId,
      projectId
    });
  }

  const sourceFileName = file.fileName;
  const sourceNodePath = sourceNodePathForStructuredEdit(edit);
  if (!sourceNodePath) {
    throw new ApiError("VALIDATION_FAILED", "Structured edit requires nodePath or propertyName.");
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
    throw new ApiError("VALIDATION_FAILED", `Invalid structured edit path: ${sourceNodePath}`, {
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
 *
 * Drafts, the submission itself, and the audit event commit in one transaction
 * (ADR-0027): a failed submit no longer leaves committed drafts or a misleading
 * "submitted" audit event behind.
 */
export async function submitStructuredEdits(
  db: Database,
  auth: AuthContext,
  input: SubmitStructuredEditsInput,
  context: ParameterSubmissionContext
) {
  const submissionContext = assertParameterSubmissionContext(auth, context);
  requireCanEdit(auth, input.projectId);

  if (input.edits.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "At least one structured edit is required.");
  }

  return db.transaction(async (tx) => {
    const seenKeys = new Set<string>();
    const items: Array<Extract<SubmitParameterChangesInput["items"][number], { parameterId: string }>> = [];

    for (const edit of input.edits) {
      const key = `${edit.fileId}:${sourceNodePathForStructuredEdit(edit)}`;
      if (seenKeys.has(key)) {
        throw new ApiError("VALIDATION_FAILED", "Duplicate structured edit for the same property.", {
          fileId: edit.fileId,
          nodePath: edit.nodePath,
          propertyName: edit.propertyName
        });
      }
      seenKeys.add(key);

      const parameter = await resolveStructuredEditToParameter(tx, auth, input.projectId, edit);
      const reason =
        edit.reason?.trim() ||
        `Structured edit: ${sourceNodePathForStructuredEdit(edit)}`;

      await upsertDraft(tx, {
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

    const result = await submitStructuredEditItems(tx, auth, input, items, submissionContext);

    await writeTrustedAuditEventInTx(asAuditTx(tx), {
      invocation: submissionContext.invocation,
      ...(submissionContext.invocation.initiator === "system"
        ? { organizationId: auth.organization.id }
        : {}),
      traceId: submissionContext.requestId,
      projectId: input.projectId,
      app: "parameter-management",
      kind: "parameter-structured-edit-submit",
      action: "submit",
      severity: "Medium",
      targetType: "parameter-submission-round",
      targetId: input.projectId,
      metadata: {
        editCount: input.edits.length,
        parameterIds: items.map((item) => item.parameterId)
      }
    });
    return result;
  });
}

function submitStructuredEditItems(
  tx: Database,
  auth: AuthContext,
  input: SubmitStructuredEditsInput,
  items: Array<Extract<SubmitParameterChangesInput["items"][number], { parameterId: string }>>,
  context: ParameterSubmissionContext
) {
  return submitParameterChanges(
    tx,
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
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  }
}

function requireCanEdit(auth: AuthContext, projectId?: string) {
  if (canEditParameters(auth, projectId)) return;
  // A caller who holds parameter:edit but not on this project failed the
  // project scope, not the capability check.
  const scopedOnly = projectId !== undefined && canEditParameters(auth);
  throw new ApiError(
    "FORBIDDEN",
    scopedOnly ? "Parameter edit role is required for this project." : "Parameter edit permission is required."
  );
}

function requireCanAdminImport(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Admin access is required for parameter import.");
  }
}

export function parseDtsImportForAuth(auth: AuthContext, input: ParseDtsImportBody) {
  requireCanAdminImport(auth);
  const parsed = parseDtsImportBodySchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", "Invalid DTS import parse request.", {
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

  throw new ApiError("FORBIDDEN", getReviewForbiddenMessage(fromStatus));
}

function requireCanMerge(auth: AuthContext, projectId: string | undefined) {
  if (canMergeParameters(auth, projectId)) return;

  throw new ApiError("FORBIDDEN", "Parameter merge role is required for this project.");
}

function getCompleteWorkflowAssignees(input: SubmitParameterChangesInput) {
  const assignees = input.assignees;
  if (!assignees) {
    return undefined;
  }

  if (!assignees?.hardwareCommitterId || !assignees.softwareCommitterId || !assignees.softwareUserId) {
    throw new ApiError("VALIDATION_FAILED", "Workflow assignees must include all review roles or be omitted.");
  }

  return {
    hardwareCommitterId: assignees.hardwareCommitterId,
    softwareCommitterId: assignees.softwareCommitterId,
    softwareUserId: assignees.softwareUserId
  };
}

function assertUniqueSubmissionParameters(items: SubmitParameterChangesInput["items"]) {
  const bindingIds = new Set<string>();
  const enablementIds = new Set<string>();
  const legacyParameterIds = new Set<string>();

  for (const item of items) {
    if ("draftId" in item) {
      if (isEnablementSubmissionItem(item)) {
        if (enablementIds.has(item.logicalNodeId)) {
          throw new ApiError("VALIDATION_FAILED", "Each parameter can only appear once per submission round.", {
            logicalNodeId: item.logicalNodeId
          });
        }
        enablementIds.add(item.logicalNodeId);
        continue;
      }

      if (bindingIds.has(item.projectParameterBindingId)) {
        throw new ApiError("VALIDATION_FAILED", "Each parameter can only appear once per submission round.", {
          parameterId: item.projectParameterBindingId
        });
      }
      bindingIds.add(item.projectParameterBindingId);
      continue;
    }

    if (legacyParameterIds.has(item.parameterId)) {
      throw new ApiError("VALIDATION_FAILED", "Each parameter can only appear once per submission round.", {
        parameterId: item.parameterId
      });
    }
    legacyParameterIds.add(item.parameterId);
  }
}

function assertValidCreateImportInput(input: CreateImportPreviewInput) {
  const parsed = createImportBatchBodySchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", "Invalid parameter import item.", {
      issues: parsed.error.issues
    });
  }

  return parsed.data;
}

function assertValidApplyImportInput(input: ApplyImportBatchInput) {
  const parsed = applyImportBatchBodySchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", "Invalid parameter import apply request.", {
      issues: parsed.error.issues
    });
  }

  if (parsed.data.selectedItemIds && parsed.data.selectedItemIds.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "At least one import item must be selected.");
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
      throw new ApiError("VALIDATION_FAILED", "Workflow assignee is not eligible for the requested role.", {
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
    throw new ApiError("NOT_FOUND", "Parameter was not found for this project.", { parameterId, projectId });
  }

  return parameter;
}

async function loadChangeRequestForReview(db: Queryable, auth: AuthContext, requestId: string) {
  const request = await getChangeRequestById(db, {
    organizationId: auth.organization.id,
    requestId
  });

  if (!request) {
    throw new ApiError("NOT_FOUND", "Parameter change request was not found.", { requestId });
  }

  return request;
}

async function loadProjectForImport(db: Queryable, auth: AuthContext, projectId: string) {
  const project = await getProjectById(db, {
    organizationId: auth.organization.id,
    projectId
  });

  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", { projectId });
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
    if (decision.reviewerUserId) userIds.add(decision.reviewerUserId);
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
    const executionName = decision.reviewerUserId
      ? names.get(decision.reviewerUserId) ?? decision.reviewerUserId
      : decision.initiatorType === "system"
        ? `System ${decision.initiatorSystemKind ?? "service"}:${decision.initiatorSystemName ?? "unknown"}`
        : decision.initiatorType === "agent"
          ? `Agent tool:${decision.initiatorToolCallId ?? "unknown"}`
          : "未指派";
    participants.push({
      role: parameterStatusLabels[decision.fromStatus as ParameterChangeRequestStatus],
      name: executionName,
      action: decision.decision === "advance" ? "推进流程" : "打回变更",
      note: decision.note ?? undefined,
      time: decision.createdAt
    });
  }

  return participants;
}

const workflowTrailTransitions = {
  hardware_review: { fromStatus: "hardware_review", toStatus: "software_review" },
  software_review: { fromStatus: "software_review", toStatus: "software_merge" },
  software_merge: { fromStatus: "software_merge", toStatus: "merged" },
} as const;

function reviewDecisionExecutionLabel(
  decision: Awaited<ReturnType<typeof listReviewDecisions>>[number],
  userNames: Map<string, string>,
): string {
  if (decision.reviewerUserId) {
    return userNames.get(decision.reviewerUserId) ?? decision.reviewerUserId;
  }
  if (decision.initiatorType === "system") {
    return `System ${decision.initiatorSystemKind ?? "service"}:${decision.initiatorSystemName ?? "unknown"}`;
  }
  if (decision.initiatorType === "agent") {
    return `Agent tool:${decision.initiatorToolCallId ?? "unknown"} (session:${decision.initiatorSessionId ?? "unknown"})`;
  }
  return "未指派";
}

function preserveTrustedWorkflowExecutors(
  trail: Awaited<ReturnType<typeof buildSubmissionWorkflowTrail>>,
  decisions: Awaited<ReturnType<typeof listReviewDecisions>>,
  userNames: Map<string, string>,
) {
  return trail.map((stage) => {
    const transition = workflowTrailTransitions[stage.key];
    const uniqueLabels = [
      ...new Set(
        decisions
          .filter(
            (decision) =>
              decision.decision === "advance" &&
              decision.fromStatus === transition.fromStatus &&
              decision.toStatus === transition.toStatus,
          )
          .map((decision) => reviewDecisionExecutionLabel(decision, userNames))
          .filter(Boolean),
      ),
    ];
    if (uniqueLabels.length === 0) return stage;
    return {
      ...stage,
      executorName: uniqueLabels.length === 1 ? uniqueLabels[0] : `${uniqueLabels[0]} 等 ${uniqueLabels.length} 人`,
      executorLabel: "执行人" as const,
    };
  });
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
    changeAction: request.action,
    candidateConfigRevisionId: request.candidateConfigRevisionId,
    risk: parameterImpact?.risk,
    reason: parameterImpact?.note,
    submitter: request.submitter,
    participants: input.participants
  };
}

async function createParameterReviewAudit(
  tx: AuditTx,
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
  // requestId fallback survives only until review-flow contexts become mandatory
  // (audited-write migration batches, ADR-0027).
  await writeAuditEventInTx(tx, auth, { requestId: context.requestId ?? randomUUID() }, {
    app: "parameter-management",
    kind: input.kind,
    action: input.action,
    severity: input.kind === "parameter-merge" ? "High" : "Medium",
    projectId: input.projectId ?? null,
    targetType: "parameter-change-request",
    targetId: input.requestId,
    metadata: buildChangeRequestAuditMetadata(input.changeRequest, {
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      note: input.note,
      expectedVersion: input.expectedVersion,
      participants: input.participants
    })
  });
}

async function createImportAudit(
  tx: AuditTx,
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
  // requestId fallback survives only until import contexts become mandatory
  // (audited-write migration batches, ADR-0027).
  await writeAuditEventInTx(tx, auth, { requestId: context.requestId ?? randomUUID() }, {
    app: "parameter-management",
    kind: "batch-import",
    action: input.action ?? "apply",
    severity: "High",
    projectId: input.projectId,
    targetType: "parameter-import-batch",
    targetId: input.batchId,
    metadata: {
      batchId: input.batchId,
      summary: input.summary,
      ...(input.reviewMetadata ? { reviewMetadata: input.reviewMetadata } : {})
    }
  });
}

export async function createImportPreview(
  db: Database,
  auth: AuthContext,
  input: CreateImportPreviewInput,
  context: ServiceContext = {}
) {
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
  // Batch row and its preview audit commit together (ADR-0027); previously the batch
  // insert ran auto-committed and the audit could be lost after it.
  // requestId fallback survives only until import contexts become mandatory.
  return withAuditedWrite(db, auth, { requestId: context.requestId ?? randomUUID() }, async (tx) => {
    const batch = await insertImportBatch(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      projectId: parsed.projectId,
      createdByUserId: auth.user.id,
      sourceName: parsed.sourceName,
      summary,
      items: previewItems
    });

    if (parsed.reviewMetadata) {
      await createImportAudit(asAuditTx(tx), auth, {
        projectId: parsed.projectId,
        batchId: batch.id,
        summary: {
          added: summary.added,
          updated: summary.updated,
          skipped: parsed.reviewMetadata.skippedRows?.length ?? 0
        },
        action: "preview",
        reviewMetadata: parsed.reviewMetadata
      }, context);
    }

    return { result: batch, audit: null };
  });
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
      throw new ApiError("NOT_FOUND", "Parameter import batch was not found.", { batchId: parsed.batchId });
    }
    if (batch.status !== "previewed") {
      throw new ApiError("CONFLICT", "Parameter import batch has already been applied.", { batchId: parsed.batchId });
    }

    await loadProjectForImport(tx, auth, batch.projectId);

    if (parsed.selectedItemIds) {
      const batchItemIds = new Set(batch.items.map((item) => item.id));
      const unknownItemId = parsed.selectedItemIds.find((itemId) => !batchItemIds.has(itemId));
      if (unknownItemId) {
        throw new ApiError("VALIDATION_FAILED", "Selected import item was not found in the batch.", {
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
      throw new ApiError("CONFLICT", "Cannot apply import items with open change requests.", {
        batchId: parsed.batchId,
        itemId: conflictItem.id
      });
    }
    if (selectedItems.length === 0) {
      throw new ApiError("VALIDATION_FAILED", "At least one eligible import item must be selected.", {
        batchId: parsed.batchId
      });
    }

    const selectedItemsWithTargets = selectedItems.map((item) => {
      if (!item.definitionId || !item.projectParameterValueId) {
        throw new ApiError("VALIDATION_FAILED", "Import preview item is missing persisted target identifiers.", {
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
        throw new ApiError("CONFLICT", "Cannot apply import items with open change requests.", {
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
        if (parameterIdentityMode() === "semantic") {
          throw new ApiError(
            "GONE",
            "Post-cutover import cannot create new parameter identity; ingest DTS instead.",
            { batchId: parsed.batchId, itemId: item.id, diagnostic: "semantic-import-add-retired" }
          );
        }
        const appliedItem = await applyAddedImportItem(tx, {
          organizationId: auth.organization.id,
          projectId: batch.projectId,
          actorUserId: auth.user.id,
          historyId: randomUUID(),
          item
        });
        if (!appliedItem) {
          throw new ApiError("CONFLICT", "Import item definition id already exists.", {
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
          throw new ApiError("CONFLICT", "Import item definition id already exists.", {
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
      throw new ApiError("NOT_FOUND", "Parameter import batch was not found.", { batchId: parsed.batchId });
    }

    await createImportAudit(asAuditTx(tx), auth, {
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
  requireCanEdit(auth, input.projectId);
  if (parameterIdentityMode() === "semantic") {
    throw new ApiError(
      "CONFLICT",
      "Legacy parameter drafts are retired after semantic identity cutover; create a typed binding draft instead.",
      { projectId: input.projectId }
    );
  }
  await loadParameterForSubmission(db, auth, input.projectId, input.parameterId);

  return upsertDraft(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    parameterId: input.parameterId,
    userId: auth.user.id,
    targetValue: input.targetValue,
    reason: input.reason,
    origin: "manual",
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

export async function listWorkflowAssignees(db: Queryable, auth: AuthContext, projectId: string) {
  requireCanEdit(auth);
  return listEligibleWorkflowAssignees(db, {
    organizationId: auth.organization.id,
    projectId,
  });
}

export async function submitParameterChanges(
  db: Database,
  auth: AuthContext,
  input: SubmitParameterChangesInput,
  context: ParameterSubmissionContext
) {
  const submissionContext = assertParameterSubmissionContext(auth, context);
  requireCanEdit(auth, input.projectId);

  if (input.items.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "At least one parameter change is required.");
  }
  assertUniqueSubmissionParameters(input.items);
  const workflowAssignees = getCompleteWorkflowAssignees(input);

  return db.transaction(async (tx) => {
    await assertProjectAllowsParameterSubmit(tx, auth.organization.id, input.projectId);

    const useSemanticIdentity = parameterIdentityMode() === "semantic";
    if (useSemanticIdentity && input.items.some((item) => !("draftId" in item))) {
      throw new ApiError(
        "CONFLICT",
        "Legacy parameter submission is retired after semantic identity cutover; submit an exact binding draft.",
        { projectId: input.projectId }
      );
    }
    const bindingEntries: Array<{
      item: SubmitParameterChangesInput["items"][number];
      parameter: Awaited<ReturnType<typeof loadParameterForSubmission>>;
      parameterId: string;
      exactDraft?: NonNullable<Awaited<ReturnType<typeof getBindingDraftForSubmission>>>;
    }> = [];
    const enablementEntries: Array<{
      item: EnablementSubmissionItem;
      exactDraft: NonNullable<Awaited<ReturnType<typeof getEnablementDraftForSubmission>>>;
      currentValue: string;
    }> = [];

    for (const item of input.items) {
      if ("draftId" in item && isEnablementSubmissionItem(item)) {
        if (!useSemanticIdentity) {
          throw new ApiError("CONFLICT", "Enablement draft submission requires completed semantic identity cutover.", {
            draftId: item.draftId
          });
        }

        const loadedDraft = await getEnablementDraftForSubmission(tx, {
          organizationId: auth.organization.id,
          projectId: input.projectId,
          userId: auth.user.id,
          draftId: item.draftId
        });
        if (!loadedDraft) {
          throw new ApiError("NOT_FOUND", "Enablement draft was not found for this project.", {
            draftId: item.draftId,
            projectId: input.projectId
          });
        }
        if (loadedDraft.logicalNodeId !== item.logicalNodeId) {
          throw new ApiError("CONFLICT", "Enablement draft identity does not match the submitted logical node.", {
            draftId: item.draftId,
            logicalNodeId: item.logicalNodeId
          });
        }
        const submittedAction = item.action ?? "set";
        if (
          loadedDraft.action !== submittedAction ||
          loadedDraft.targetValue !== item.targetValue ||
          loadedDraft.reason !== item.reason
        ) {
          throw new ApiError("CONFLICT", "Enablement draft action, value, or reason changed before submission.", {
            draftId: item.draftId
          });
        }
        if (
          !loadedDraft.candidateConfigRevisionId ||
          loadedDraft.candidateStatus !== "draft" ||
          !loadedDraft.candidateActionProven
        ) {
          throw new ApiError("CONFLICT", "Enablement draft candidate revision is missing, stale, or action-mismatched.", {
            draftId: item.draftId,
            action: submittedAction,
            candidateConfigRevisionId: loadedDraft.candidateConfigRevisionId,
            candidateStatus: loadedDraft.candidateStatus,
            candidateHasStatusEffect: loadedDraft.candidateHasStatusEffect,
            candidateValueMatchesDraft: loadedDraft.candidateValueMatchesDraft,
            candidateDeleteTombstone: loadedDraft.candidateDeleteTombstone
          });
        }
        if (!loadedDraft.writeLock || !loadedDraft.writeLockMatchesRevision) {
          throw new ApiError("CONFLICT", "Enablement draft is missing exact writeback lock metadata.", {
            draftId: item.draftId
          });
        }
        await verifyEnablementWriteLock(tx, loadedDraft.writeLock);

        const openRequest = await findOpenEnablementChangeRequest(tx, {
          organizationId: auth.organization.id,
          projectId: input.projectId,
          logicalNodeId: item.logicalNodeId
        });
        if (openRequest) {
          throw new ApiError("CONFLICT", "Logical node already has an open change request.", {
            logicalNodeId: item.logicalNodeId,
            requestId: openRequest.id
          });
        }

        const nodeContext = await loadLogicalNodeEnablementContext(tx, {
          organizationId: auth.organization.id,
          projectId: input.projectId,
          configRevisionId: loadedDraft.writeLock.baseConfigRevisionId,
          logicalNodeId: item.logicalNodeId
        });
        await assertTrustedSensitiveNodeSubmissionAllowed(tx, auth, {
          organizationId: auth.organization.id,
          projectId: input.projectId,
          nodePath: nodeContext.nodeLocator,
          compatible: nodeContext.compatible,
          invocation: submissionContext.invocation,
          requestId: submissionContext.requestId,
          refusalSink: submissionContext.refusalSink
        });

        enablementEntries.push({
          item,
          exactDraft: loadedDraft,
          currentValue: nodeContext.currentRaw ?? ""
        });
        continue;
      }

      let parameterId: string;
      let exactDraft: NonNullable<Awaited<ReturnType<typeof getBindingDraftForSubmission>>> | undefined;
      if ("draftId" in item) {
        if (!useSemanticIdentity) {
          throw new ApiError("CONFLICT", "Binding draft submission requires completed semantic identity cutover.", {
            draftId: item.draftId
          });
        }
        const loadedDraft = await getBindingDraftForSubmission(tx, {
          organizationId: auth.organization.id,
          projectId: input.projectId,
          userId: auth.user.id,
          draftId: item.draftId
        });
        if (!loadedDraft) {
          throw new ApiError("NOT_FOUND", "Binding draft was not found for this project.", {
            draftId: item.draftId,
            projectId: input.projectId
          });
        }
        if (
          loadedDraft.bindingId !== item.projectParameterBindingId ||
          loadedDraft.parameterSpecId !== item.parameterSpecId
        ) {
          throw new ApiError("CONFLICT", "Binding draft identity does not match the submitted binding/spec.", {
            draftId: item.draftId,
            projectParameterBindingId: item.projectParameterBindingId,
            parameterSpecId: item.parameterSpecId
          });
        }
        const submittedAction = item.action ?? "set";
        if (
          loadedDraft.action !== submittedAction ||
          loadedDraft.targetValue !== item.targetValue ||
          loadedDraft.reason !== item.reason
        ) {
          throw new ApiError("CONFLICT", "Binding draft action, value, or reason changed before submission.", {
            draftId: item.draftId
          });
        }
        if (
          !loadedDraft.candidateConfigRevisionId ||
          loadedDraft.candidateStatus !== "draft" ||
          !loadedDraft.candidateActionProven
        ) {
          throw new ApiError("CONFLICT", "Binding draft candidate revision is missing, stale, or action-mismatched.", {
            draftId: item.draftId,
            action: submittedAction,
            candidateConfigRevisionId: loadedDraft.candidateConfigRevisionId,
            candidateStatus: loadedDraft.candidateStatus,
            candidateHasBindingRevision: loadedDraft.candidateHasBindingRevision,
            candidateValueMatchesDraft: loadedDraft.candidateValueMatchesDraft,
            candidateDeleteTombstone: loadedDraft.candidateDeleteTombstone
          });
        }
        if (!loadedDraft.writeLock || !loadedDraft.writeLockMatchesBinding) {
          throw new ApiError("CONFLICT", "Binding draft is missing exact writeback lock metadata.", {
            draftId: item.draftId
          });
        }
        await verifyBindingWriteLock(tx, loadedDraft.writeLock);
        parameterId = loadedDraft.bindingId;
        exactDraft = loadedDraft;
      } else {
        parameterId = item.parameterId;
      }

      const parameter = await loadParameterForSubmission(tx, auth, input.projectId, parameterId);
      const openRequest = await findOpenChangeRequest(tx, {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        parameterId
      });

      if (openRequest) {
        throw new ApiError("CONFLICT", "Parameter already has an open change request.", {
          parameterId,
          requestId: openRequest.id
        });
      }
      const hasConflict = await hasOpenFileSyncConflict(tx, {
        projectParameterValueId: parameter.id
      });
      if (hasConflict) {
        throw new ApiError("CONFLICT", "Parameter has an open file sync conflict.", {
          parameterId
        });
      }

      if (exactDraft?.writeLock && exactDraft.logicalNodeId) {
        const node = await loadLogicalNodeSubmissionContext(tx, {
          organizationId: auth.organization.id,
          projectId: input.projectId,
          configRevisionId: exactDraft.writeLock.baseConfigRevisionId,
          logicalNodeId: exactDraft.logicalNodeId
        });
        await assertTrustedSensitiveNodeSubmissionAllowed(tx, auth, {
          organizationId: auth.organization.id,
          projectId: input.projectId,
          nodePath: node.nodeLocator,
          compatible: node.compatible,
          invocation: submissionContext.invocation,
          requestId: submissionContext.requestId,
          refusalSink: submissionContext.refusalSink
        });
      } else if (!exactDraft && parameter.sourceNodePath) {
        await assertTrustedSensitiveNodeSubmissionAllowed(tx, auth, {
          organizationId: auth.organization.id,
          projectId: input.projectId,
          nodePath: parameter.sourceNodePath,
          sourceFileName: parameter.sourceFileName,
          invocation: submissionContext.invocation,
          requestId: submissionContext.requestId,
          refusalSink: submissionContext.refusalSink
        });
      }

      if ("draftId" in item) {
        bindingEntries.push({ item, parameter, parameterId, exactDraft });
      } else {
        bindingEntries.push({ item, parameter, parameterId });
      }
    }

    const tipIds = [
      ...new Set(
        [
          ...bindingEntries.map(({ exactDraft }) => exactDraft?.candidateConfigRevisionId?.trim()),
          ...enablementEntries.map(({ exactDraft }) => exactDraft.candidateConfigRevisionId?.trim())
        ].filter((id): id is string => Boolean(id))
      )
    ];
    if (input.items.some((item) => "draftId" in item) && tipIds.length > 1) {
      throw new ApiError(
        "CONFLICT",
        "本轮草稿不在同一工作版本上，无法一起提交。请移除冲突项或清空后重新编辑。",
        { reason: "mixed-working-tips", candidateConfigRevisionIds: tipIds }
      );
    }

    await assertWorkflowAssigneesAreEligible(tx, auth, input.projectId, workflowAssignees);

    const promotionDrafts: Array<{ draftId: string; candidateConfigRevisionId: string }> = [];
    const seenPromotionTips = new Set<string>();
    for (const { item, exactDraft } of bindingEntries) {
      if (!("draftId" in item) || !exactDraft?.candidateConfigRevisionId) continue;
      if (seenPromotionTips.has(exactDraft.candidateConfigRevisionId)) continue;
      seenPromotionTips.add(exactDraft.candidateConfigRevisionId);
      promotionDrafts.push({
        draftId: item.draftId,
        candidateConfigRevisionId: exactDraft.candidateConfigRevisionId
      });
    }
    for (const { item, exactDraft } of enablementEntries) {
      if (!exactDraft.candidateConfigRevisionId) continue;
      if (seenPromotionTips.has(exactDraft.candidateConfigRevisionId)) continue;
      seenPromotionTips.add(exactDraft.candidateConfigRevisionId);
      promotionDrafts.push({
        draftId: item.draftId,
        candidateConfigRevisionId: exactDraft.candidateConfigRevisionId
      });
    }

    for (const draft of promotionDrafts) {
      const promoted = await promoteBindingDraftCandidateForReview(tx, {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        draftId: draft.draftId,
        candidateConfigRevisionId: draft.candidateConfigRevisionId
      });
      if (!promoted) {
        throw new ApiError("CONFLICT", "Draft candidate changed before review promotion.", {
          draftId: draft.draftId,
          candidateConfigRevisionId: draft.candidateConfigRevisionId
        });
      }
    }

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
    for (const { item, parameter, exactDraft } of bindingEntries) {
      let projectParameterBindingId: string | undefined;
      let parameterSpecId: string | undefined;
      let writeLock;

      if ("draftId" in item) {
        projectParameterBindingId = exactDraft!.bindingId;
        parameterSpecId = exactDraft!.parameterSpecId;
        writeLock = exactDraft!.writeLock;
      } else {
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
        projectParameterBindingId =
          item.projectParameterBindingId ?? draftIdentity.rows[0]?.project_parameter_binding_id ?? undefined;
        parameterSpecId = item.parameterSpecId;
        if (!parameterSpecId && projectParameterBindingId) {
          const bindingSpec = await tx.query<{ parameter_spec_id: string }>(
            `select parameter_spec_id
             from project_parameter_bindings
             where id = $1 and organization_id = $2 and project_id = $3
             limit 1`,
            [projectParameterBindingId, auth.organization.id, input.projectId]
          );
          parameterSpecId = bindingSpec.rows[0]?.parameter_spec_id;
        }

        writeLock =
          projectParameterBindingId && useSemanticIdentity
            ? await getDraftWriteLock(tx, {
                organizationId: auth.organization.id,
                projectId: input.projectId,
                bindingId: projectParameterBindingId,
                userId: auth.user.id
              })
            : null;
        if (projectParameterBindingId && useSemanticIdentity && !writeLock) {
          throw new ApiError("CONFLICT", "Draft is missing exact writeback lock metadata.", {
            parameterId: parameter.id
          });
        }
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
        action: "draftId" in item ? item.action ?? "set" : "set",
        status,
        submitterUserId: auth.user.id,
        assignedToUserId: workflowAssignees?.hardwareCommitterId,
        workflowAssignees,
        parameterSpecId,
        projectParameterBindingId,
        candidateConfigRevisionId: exactDraft?.candidateConfigRevisionId ?? undefined,
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
        action: "draftId" in item ? item.action ?? "set" : "set",
        reason: item.reason,
        projectParameterBindingId,
        candidateConfigRevisionId: exactDraft?.candidateConfigRevisionId ?? undefined
      });

      if ("draftId" in item) {
        await deleteDraftRow(tx, {
          organizationId: auth.organization.id,
          userId: auth.user.id,
          draftId: item.draftId
        });
      } else {
        await deleteDraftForParameter(tx, {
          organizationId: auth.organization.id,
          userId: auth.user.id,
          projectId: input.projectId,
          parameterId: parameter.id
        });
      }

      items.push(submissionItem);
    }

    for (const { item, exactDraft, currentValue } of enablementEntries) {
      const request = await createEnablementChangeRequest(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        submissionRoundId: round.id,
        projectId: input.projectId,
        logicalNodeId: item.logicalNodeId,
        baseVersion: 0,
        currentValue,
        targetValue: item.targetValue,
        action: item.action ?? "set",
        status,
        submitterUserId: auth.user.id,
        assignedToUserId: workflowAssignees?.hardwareCommitterId,
        workflowAssignees,
        candidateConfigRevisionId: exactDraft.candidateConfigRevisionId ?? undefined,
        writeLock: exactDraft.writeLock ?? undefined
      });

      const submissionItem = await createEnablementSubmissionItem(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        submissionRoundId: round.id,
        changeRequestId: request.id,
        logicalNodeId: item.logicalNodeId,
        currentValue,
        targetValue: item.targetValue,
        action: item.action ?? "set",
        reason: item.reason,
        candidateConfigRevisionId: exactDraft.candidateConfigRevisionId ?? undefined
      });

      await deleteDraftRow(tx, {
        organizationId: auth.organization.id,
        userId: auth.user.id,
        draftId: item.draftId
      });

      items.push(submissionItem);
    }

    await writeTrustedAuditEventInTx(asAuditTx(tx), {
      invocation: submissionContext.invocation,
      ...(submissionContext.invocation.initiator === "system"
        ? { organizationId: auth.organization.id }
        : {}),
      traceId: submissionContext.requestId,
      app: "parameter-management",
      kind: "parameter-submit",
      action: "submit",
      severity: "Medium",
      projectId: input.projectId,
      targetType: "parameter-submission-round",
      targetId: round.id,
      metadata: {
        itemCount: items.length,
        status,
        bindingDraftIds: bindingEntries.flatMap(({ item }) => ("draftId" in item ? [item.draftId] : [])),
        enablementDraftIds: enablementEntries.map(({ item }) => item.draftId),
        projectParameterBindingIds: bindingEntries.flatMap(({ exactDraft }) =>
          exactDraft ? [exactDraft.bindingId] : []
        ),
        logicalNodeIds: enablementEntries.map(({ item }) => item.logicalNodeId),
        parameterSpecIds: bindingEntries.flatMap(({ exactDraft }) =>
          exactDraft ? [exactDraft.parameterSpecId] : []
        ),
        actions: input.items.map((item) => ("draftId" in item ? item.action ?? "set" : "set")),
        candidateConfigRevisionIds: tipIds
      }
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
    if (decision.reviewerUserId) userIds.add(decision.reviewerUserId);
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
        // Keep the durable nullable System decision in the timeline input.
        // This placeholder is internal to the existing trail helper; the
        // trusted executor label is restored by preserveTrustedWorkflowExecutors.
        reviewerUserId: decision.reviewerUserId ?? "",
        decision: decision.decision,
        fromStatus: decision.fromStatus,
        toStatus: decision.toStatus,
        createdAt: decision.createdAt
      })),
      resolveUserName
    });

    return {
      ...round,
      workflowTrail: preserveTrustedWorkflowExecutors(workflowTrail, roundDecisions, userNames)
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
      throw new ApiError("NOT_FOUND", "Parameter submission round was not found.", { roundId });
    }

    if (owner.submitter_user_id !== auth.user.id) {
      throw new ApiError("FORBIDDEN", "Only the submitter can withdraw this submission round.", { roundId });
    }

    if (nonWithdrawableSubmissionRoundStatuses.has(owner.status)) {
      throw new ApiError("CONFLICT", "Parameter submission round is already closed.", {
        roundId,
        status: owner.status
      });
    }

    const round = await getSubmissionRoundById(tx, {
      organizationId: auth.organization.id,
      roundId
    });

    if (!round) {
      throw new ApiError("NOT_FOUND", "Parameter submission round was not found.", { roundId });
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

    // requestId fallback survives only until this function's context becomes mandatory
    // (audited-write migration batches, ADR-0027).
    await writeAuditEventInTx(asAuditTx(tx), auth, { requestId: context.requestId ?? randomUUID() }, {
      app: "parameter-management",
      kind: "parameter-submission-withdraw",
      action: "withdraw",
      severity: "Medium",
      projectId: round.projectId,
      targetType: "parameter-submission-round",
      targetId: roundId,
      metadata: {
        itemCount: round.items.length
      }
    });

    const updated = await getSubmissionRoundById(tx, {
      organizationId: auth.organization.id,
      roundId
    });

    if (!updated) {
      throw new ApiError("NOT_FOUND", "Parameter submission round was not found.", { roundId });
    }

    return updated;
  });
}

export async function reviewChange(
  db: Database,
  auth: AuthContext,
  input: ReviewParameterChangeInput,
  context: ParameterReviewContext = {}
) {
  return db.transaction(async (tx) => {
    const request = await loadChangeRequestForReview(tx, auth, input.requestId);
    const fromStatus = request.status;

    if (fromStatus === "merged" || fromStatus === "rejected") {
      throw new ApiError("CONFLICT", "Parameter change request is already closed.", {
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
        throw new ApiError("NOT_FOUND", "Parameter change request was not found.", { requestId: input.requestId });
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
      await createParameterReviewAudit(asAuditTx(tx), auth, {
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
        throw new ApiError("CONFLICT", "Parameter change request cannot advance from its current status.", {
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
        throw new ApiError("NOT_FOUND", "Parameter change request was not found.", { requestId: input.requestId });
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
      await createParameterReviewAudit(asAuditTx(tx), auth, {
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
    const suppliedMergeContext =
      context.invocation && context.refusalSink && context.requestId !== undefined
        ? {
            invocation: context.invocation,
            refusalSink: context.refusalSink,
            requestId: context.requestId
          }
        : undefined;
    const trustedMergeContext = assertTrustedSensitiveNodeWriteContext(
      auth,
      suppliedMergeContext,
      "parameter review software merge"
    );
    if (!request.projectId) {
      throw new ApiError("CONFLICT", "Parameter merge requires an exact project identity.", {
        requestId: input.requestId
      });
    }
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
          { requestId: input.requestId }
        );
      }
    } else {
      reviewDecisions = await listReviewDecisions(tx, {
        organizationId: auth.organization.id,
        requestId: input.requestId
      });
    }

    const mergeLink = (input.note ?? "").trim();
    if (!isValidMergeLink(mergeLink)) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Merge requires an http(s) merge link in note.",
        { requestId: input.requestId }
      );
    }

    const participants = await buildReviewParticipants(tx, auth.organization.id, request, reviewDecisions);
    const mergeInvocation = trustedMergeContext.invocation;
    participants.push(
      mergeInvocation.initiator === "user"
        ? {
            role: "合入执行",
            name: mergeInvocation.principal.user.name,
            action: "合入参数",
            note: mergeLink
          }
        : mergeInvocation.initiator === "agent"
          ? {
              role: "Agent 合入执行",
              name: `tool:${mergeInvocation.toolCallId}`,
              action: "合入参数",
              note: mergeLink
            }
          : {
              role: "System 合入执行",
              name: `${mergeInvocation.identity.kind}:${mergeInvocation.identity.name}`,
              action: "合入参数",
              note: mergeLink
            }
    );

    const semanticIdentity = parameterIdentityMode() === "semantic";
    let semanticMerge:
      | {
          subject: ReturnType<typeof resolveSemanticMergeSubject>;
          objectStore: NonNullable<ServiceContext["objectStore"]>;
        }
      | undefined;
    if (semanticIdentity) {
      if (!context.objectStore) {
        throw new ApiError(
          "CONFLICT",
          "Semantic merge requires object storage for DTS writeback.",
          { requestId: input.requestId }
        );
      }
      semanticMerge = {
        objectStore: context.objectStore,
        subject: resolveSemanticMergeSubject({
          requestId: input.requestId,
          projectId: request.projectId,
          editSubjectKind: request.editSubjectKind,
          parameterId: request.parameterId,
          logicalNodeId: request.logicalNodeId
        })
      };
    }

    if (semanticMerge) {
      if (semanticMerge.subject.kind === "node-enablement") {
        await preflightMergedEnablementWriteback(tx, auth, {
          projectId: semanticMerge.subject.projectId,
          logicalNodeId: semanticMerge.subject.logicalNodeId,
          mergedValue: request.targetValue,
          action: request.action,
          changeRequestId: input.requestId,
        }, { ...context, ...trustedMergeContext });
      } else {
        await preflightMergedParameterWriteback(tx, auth, {
          projectId: semanticMerge.subject.projectId,
          parameterDefinitionId: semanticMerge.subject.parameterId,
          mergedValue: request.targetValue,
          action: request.action,
          projectParameterBindingId: semanticMerge.subject.parameterId,
          changeRequestId: input.requestId,
        }, { ...context, ...trustedMergeContext });
      }
    } else if (context.objectStore) {
      await preflightMergedParameterWriteback(tx, auth, {
        projectId: request.projectId,
        parameterDefinitionId: request.parameterId,
        mergedValue: request.targetValue,
        action: request.action,
        changeRequestId: input.requestId,
      }, { ...context, ...trustedMergeContext });
    }

    const attribution = trustedDomainAttribution(trustedMergeContext.invocation);

    const merged = await mergeChangeRequest(tx, {
      historyId: randomUUID(),
      organizationId: auth.organization.id,
      requestId: input.requestId,
      expectedVersion: input.expectedVersion,
      actorUserId: attribution.userId,
      attribution
    });

    if (!merged) {
      throw new ApiError("CONFLICT", "Parameter value changed before merge.", { requestId: input.requestId });
    }

    if (semanticMerge) {
      const writeback = semanticMerge.subject.kind === "node-enablement"
        ? await writebackMergedEnablementValue(
            asAuditTx(tx),
            semanticMerge.objectStore,
            auth,
            {
              projectId: semanticMerge.subject.projectId,
              logicalNodeId: semanticMerge.subject.logicalNodeId,
              mergedValue: merged.targetValue,
              action: merged.action,
              changeRequestId: input.requestId,
            },
            { ...context, ...trustedMergeContext }
          )
        : await writebackMergedParameterValue(
            asAuditTx(tx),
            semanticMerge.objectStore,
            auth,
            {
              projectId: semanticMerge.subject.projectId,
              parameterDefinitionId: merged.parameterDefinitionId,
              mergedValue: merged.targetValue,
              action: merged.action,
              projectParameterBindingId: merged.projectParameterBindingId,
              parameterSpecId: merged.parameterSpecId,
              changeRequestId: input.requestId,
            },
            { ...context, ...trustedMergeContext }
          );
      if (writeback.skipped) {
        throw new ApiError(
          "CONFLICT",
          "Semantic merge writeback was skipped; refusing to mark the request as merged.",
          { requestId: input.requestId }
        );
      }
    }

    const updated = await updateChangeRequestStatus(tx, {
      organizationId: auth.organization.id,
      requestId: input.requestId,
      status: "merged",
      note: mergeLink
    });

    if (!updated) {
      throw new ApiError("NOT_FOUND", "Parameter change request was not found.", { requestId: input.requestId });
    }

    await insertReviewDecision(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      requestId: input.requestId,
      reviewerUserId: attribution.userId,
      attribution,
      decision: "advance",
      fromStatus,
      toStatus: "merged",
      note: mergeLink
    });
    await updateRoundStatusIfNeeded(tx, auth, request.submissionRoundId);
    await writeTrustedAuditEventInTx(asAuditTx(tx), {
      invocation: trustedMergeContext.invocation,
      ...(trustedMergeContext.invocation.initiator === "system"
        ? { organizationId: auth.organization.id }
        : {}),
      traceId: trustedMergeContext.requestId,
      app: "parameter-management",
      kind: "parameter-merge",
      action: "merge",
      severity: "High",
      projectId: request.projectId ?? null,
      targetType: "parameter-change-request",
      targetId: input.requestId,
      metadata: buildChangeRequestAuditMetadata(request, {
        fromStatus,
        toStatus: "merged",
        note: mergeLink,
        expectedVersion: input.expectedVersion,
        participants
      })
    });

    if (!semanticIdentity && context.objectStore && request.projectId) {
      await writebackMergedParameterValue(
        asAuditTx(tx),
        context.objectStore,
        auth,
        {
          projectId: request.projectId,
          parameterDefinitionId: merged.parameterDefinitionId,
          mergedValue: merged.targetValue,
          action: merged.action,
          projectParameterBindingId: merged.projectParameterBindingId,
          parameterSpecId: merged.parameterSpecId,
          changeRequestId: input.requestId,
        },
        { ...context, ...trustedMergeContext }
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
        mergerName: trustedExecutionLabel(trustedMergeContext.invocation),
        execution: attribution,
        reviewerUserIds: reviewDecisions
          .map((decision) => decision.reviewerUserId)
          .filter((userId): userId is string => Boolean(userId))
      });
    }

    return updated;
  });
}

function requireParameterAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
  }
}

async function createParameterModuleAudit(
  tx: AuditTx,
  auth: AuthContext,
  input: {
    kind: "parameter-module-admin-create" | "parameter-module-admin-update" | "parameter-module-admin-move" | "parameter-module-admin-delete";
    action: "create" | "update" | "move" | "delete";
    module: Pick<ParameterModuleDto, "id" | "name" | "path" | "parentId">;
    metadata?: Record<string, unknown>;
  },
  context: ServiceContext = {}
) {
  // requestId fallback survives only until module-admin contexts become mandatory
  // (audited-write migration batches, ADR-0027).
  await writeAuditEventInTx(tx, auth, { requestId: context.requestId ?? randomUUID() }, {
    app: "parameter-management",
    kind: input.kind,
    action: input.action,
    severity: "Low",
    projectId: null,
    targetType: "parameter-module",
    targetId: input.module.id,
    metadata: {
      name: input.module.name,
      path: input.module.path,
      parentId: input.module.parentId,
      ...input.metadata
    }
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
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
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
  const kind = body.kind ?? "business";

  let parent: ParameterModuleDto | null = null;
  if (parentId) {
    parent = await getParameterModuleById(db, { organizationId, moduleId: parentId });
    if (!parent) {
      throw new ApiError("NOT_FOUND", "Parent parameter module was not found.", { parentId });
    }
  }

  if (kind === "business") {
    if (parent && parent.kind !== "business") {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Business modules must be root or under another business module.",
        { parentId, parentKind: parent.kind }
      );
    }
  } else if (kind === "driver-group") {
    if (!parent || parent.kind !== "business") {
      throw new ApiError(
        "VALIDATION_FAILED",
        "driver-group modules must be created under a business category.",
        { parentId, parentKind: parent?.kind ?? null }
      );
    }
  } else if (kind === "node-type") {
    if (
      !parent ||
      (parent.kind !== "business" && parent.kind !== "driver-group" && parent.kind !== "node-type")
    ) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "node-type modules must be created under a business, driver-group, or node-type module.",
        { parentId, parentKind: parent?.kind ?? null }
      );
    }
  }

  if (kind === "driver-group") {
    const { registerOrClaimDriver } = await import("../parameter-modules/service");
    const result = await registerOrClaimDriver(db, auth, {
      displayName: name,
      businessCategoryId: parentId as string,
      compatibles: body.compatibles ?? [],
      notes: body.description?.trim()
    });
    return result.item;
  }

  const existing = await getParameterModuleByName(db, { organizationId, name, parentId });
  if (existing) {
    throw new ApiError("CONFLICT", "Parameter module already exists under this parent.", { name, parentId });
  }

  const sourceKey =
    kind === "node-type" ? (body.sourceKey?.trim() || null) : null;

  return db.transaction(async (tx) => {
    const module = await createParameterModule(tx, {
      organizationId,
      name,
      parentId,
      description: body.description?.trim(),
      scope: body.scope?.trim(),
      sortOrder: body.sortOrder,
      importance: kind === "business" ? body.importance : undefined,
      kind,
      origin: "curated",
      sourceKey
    });

    await createParameterModuleAudit(
      asAuditTx(tx),
      auth,
      {
        kind: "parameter-module-admin-create",
        action: "create",
        module,
        metadata: {
          kind,
          sourceKey,
          compatibles: body.compatibles ?? []
        }
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
    throw new ApiError("NOT_FOUND", "Parameter module was not found.", { moduleId });
  }

  const nextName = body.name?.trim() ?? current.name;
  if (!nextName) {
    throw new ApiError("VALIDATION_FAILED", "Module name is required.");
  }

  const reclassifyKinds = new Set(["business", "node-type"] as const);
  const nextKind = body.kind ?? current.kind;

  if (body.kind !== undefined && body.kind !== current.kind) {
    if (!reclassifyKinds.has(current.kind as "business" | "node-type")) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Only business and node-type modules can be reclassified.",
        { moduleId, kind: current.kind }
      );
    }
    if (!reclassifyKinds.has(body.kind)) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Modules can only be reclassified to business or node-type.",
        { moduleId, kind: body.kind }
      );
    }

    if (body.kind === "business") {
      if (current.parentId) {
        const parent = await getParameterModuleById(db, {
          organizationId,
          moduleId: current.parentId
        });
        if (!parent || parent.kind !== "business") {
          throw new ApiError(
            "VALIDATION_FAILED",
            "A business category must sit under another business category or at the root.",
            { moduleId, parentId: current.parentId, parentKind: parent?.kind ?? null }
          );
        }
      }
    }

    if (current.kind === "business" && body.kind !== "business") {
      const siblings = await listParameterModules(db, { organizationId });
      const hasBusinessChild = siblings.some(
        (module) => module.parentId === moduleId && module.kind === "business"
      );
      if (hasBusinessChild) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Cannot leave the business category while business children remain.",
          { moduleId }
        );
      }
    }
  }

  if (body.importance !== undefined && nextKind !== "business") {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Importance can only be set on business-category modules.",
      { moduleId, kind: nextKind }
    );
  }

  if (nextName !== current.name) {
    const conflict = await getParameterModuleByName(db, {
      organizationId,
      name: nextName,
      parentId: current.parentId
    });
    if (conflict && conflict.id !== current.id) {
      throw new ApiError("CONFLICT", "Parameter module already exists under this parent.", {
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
      sortOrder: body.sortOrder,
      importance: body.importance,
      kind: body.kind
    });
    if (!module) {
      throw new ApiError("NOT_FOUND", "Parameter module was not found.", { moduleId });
    }

    await createParameterModuleAudit(
      asAuditTx(tx),
      auth,
      {
        kind: "parameter-module-admin-update",
        action: "update",
        module,
        metadata: {
          previousName: current.name,
          previousKind: current.kind
        }
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
    throw new ApiError("NOT_FOUND", "Parameter module was not found.", { moduleId });
  }

  const parentId = body.parentId;
  if (parentId) {
    const parent = await getParameterModuleById(db, { organizationId, moduleId: parentId });
    if (!parent) {
      throw new ApiError("NOT_FOUND", "Target parent parameter module was not found.", { parentId });
    }
  }

  if (parentId === current.parentId) {
    return current;
  }

  const nextName = current.name;
  const conflict = await getParameterModuleByName(db, { organizationId, name: nextName, parentId });
  if (conflict && conflict.id !== current.id) {
    throw new ApiError("CONFLICT", "Parameter module already exists under the target parent.", {
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
        throw new ApiError("NOT_FOUND", "Parameter module was not found.", { moduleId });
      }

      await createParameterModuleAudit(
        asAuditTx(tx),
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
      throw new ApiError("CONFLICT", error.message, { moduleId, parentId });
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
    throw new ApiError("NOT_FOUND", "Parameter module was not found.", { moduleId });
  }

  if (current.kind === "driver-group") {
    const { disbandDriverGroupModule } = await import("../parameter-modules/service");
    // Disband and its audit commit together (ADR-0027); the disband's own transaction
    // degrades to a savepoint. requestId fallback survives until contexts are mandatory.
    await withAuditedWrite(db, auth, { requestId: context.requestId ?? randomUUID() }, async (tx) => {
      await disbandDriverGroupModule(tx, auth, { moduleId });
      await createParameterModuleAudit(
        asAuditTx(tx),
        auth,
        {
          kind: "parameter-module-admin-delete",
          action: "delete",
          module: current,
          metadata: { disbanded: true }
        },
        context
      );
      return { result: undefined, audit: null };
    });
    return;
  }

  const childCount = await countParameterModuleChildren(db, { organizationId, moduleId });
  if (childCount > 0) {
    throw new ApiError("CONFLICT", "Cannot delete a parameter module that still has child modules.", {
      moduleId,
      childCount
    });
  }

  const parameterCount = await countParametersForModule(db, { organizationId, moduleId });
  if (parameterCount > 0) {
    throw new ApiError("CONFLICT", "Cannot delete a parameter module referenced by parameters.", {
      moduleId,
      parameterCount
    });
  }

  await db.transaction(async (tx) => {
    const deleted = await deleteParameterModule(tx, { organizationId, moduleId });
    if (!deleted) {
      throw new ApiError("NOT_FOUND", "Parameter module was not found.", { moduleId });
    }

    await createParameterModuleAudit(
      asAuditTx(tx),
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
