import { randomUUID } from "node:crypto";
import pg from "pg";

import {
  asAuditTx,
  withAuditedWrite,
  writeAuditEventInTx,
  writeTrustedAuditEventInTx,
  type AuditTx,
  type AuditedWriteContext
} from "../audit/auditedWrite";
import { writeTrustedGovernanceAudit } from "../parameter-topology/governanceAudit";
import {
  notifyParameterMergeCompleted,
  notifyParameterReviewAdvanced,
  notifyParameterReviewRejected,
  notifyParameterReviewSubmitted
} from "../notifications/producers";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import {
  assertTrustedInvocationContext,
  assertTrustedInvocationMatchesAuth,
  assertTrustedMutationInvocation,
  createUserInvocation,
  trustedDomainAttribution,
  trustedPublicExecutionLabel,
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
import { catalogLegacyGoneResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { catalogLegacyGoneResult, LEGACY_WRITE_GONE_MESSAGE } from "../parameter-catalog-api/legacy/gone";
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
  listReviewDecisionsForRequestIdsInternal,
  listReviewDecisionsInternal,
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
import type { ChangeRequestDto, ParameterModuleDto } from "./types";
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
  assertTrustedMutationInvocation(invocation, "parameter submission");
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

async function loadChangeRequestForReview(db: Queryable, auth: AuthContext, requestId: string, lock = true) {
  const request = await getChangeRequestById(db, {
    organizationId: auth.organization.id,
    requestId,
    lock
  });

  if (!request) {
    throw new ApiError("NOT_FOUND", "Parameter change request was not found.", { requestId });
  }

  return request;
}

function hasHighRiskReviewEvidence(
  decisions: Awaited<ReturnType<typeof listReviewDecisionsInternal>>
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
  decisions: Awaited<ReturnType<typeof listReviewDecisionsInternal>>
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
    const executionName = reviewDecisionExecutionLabel(decision, names);
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
  decision: Awaited<ReturnType<typeof listReviewDecisionsInternal>>[number],
  userNames: Map<string, string>,
): string {
  if (decision.initiatorType === "system") {
    return `WiseEff System ${decision.initiatorSystemKind ?? "service"}`;
  }
  if (decision.initiatorType === "agent") {
    return "WiseEff Agent";
  }
  if (decision.reviewerUserId) {
    // A name lookup is deliberately organization-scoped.  If a malformed or
    // cross-organization reviewer reference cannot be resolved, never expose
    // the raw internal user id through the public workflow projection.
    return userNames.get(decision.reviewerUserId) ?? "未知用户";
  }
  return "未指派";
}

function preserveTrustedWorkflowExecutors(
  trail: Awaited<ReturnType<typeof buildSubmissionWorkflowTrail>>,
  decisions: Awaited<ReturnType<typeof listReviewDecisionsInternal>>,
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

export async function deleteDraft(
  db: Database,
  auth: AuthContext,
  draftId: string,
  context?: { invocation: TrustedInvocationContext; projectId?: string; requestId?: string }
) {
  requireCanEdit(auth, context?.projectId);

  const invocation = context
    ? assertTrustedInvocationMatchesAuth(auth, context.invocation, "parameter draft delete")
    : createUserInvocation(auth);
  const attribution = trustedDomainAttribution(invocation);

  await db.transaction(async (tx) => {
    const removedProjectId = await deleteDraftRow(tx, {
      organizationId: auth.organization.id,
      ...(context?.projectId === undefined ? {} : { projectId: context.projectId }),
      owner: attribution,
      draftId
    });
    if (!removedProjectId) {
      if (context?.projectId !== undefined) {
        throw new ApiError("NOT_FOUND", "Parameter draft was not found for this project.", {
          projectId: context.projectId,
          draftId
        });
      }
      return;
    }
    requireCanEdit(auth, removedProjectId);

    await writeTrustedGovernanceAudit(
      asAuditTx(tx),
      invocation,
      {
        action: "value-draft-removed",
        organizationId: auth.organization.id,
        projectId: removedProjectId,
        targetType: "project-parameter-value-draft",
        targetId: draftId,
        metadata: {
          draftId,
          writeTargetRole: "legacy-parameter-value-draft"
        }
      },
      context?.requestId ?? randomUUID()
    );
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
  const submissionAttribution = trustedDomainAttribution(submissionContext.invocation);
  const submissionOwner = {
    userId: submissionAttribution.userId,
    initiatorType: submissionAttribution.initiatorType,
    systemKind: submissionAttribution.systemKind,
    systemName: submissionAttribution.systemName,
  } as const;

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
          owner: submissionOwner,
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
          // This token is selected from the exact draft/base revision, never
          // from a request payload or mutable current head.
          compatibleIsAuthoritative: true,
          invocation: submissionContext.invocation,
          requestId: submissionContext.requestId,
          refusalSink: submissionContext.refusalSink
        });

        if (!loadedDraft.ownerMatches) {
          throw new ApiError("FORBIDDEN", "Parameter draft owner does not match the trusted invocation.", {
            code: "parameter-draft-owner-mismatch",
            draftId: loadedDraft.id,
            projectId: input.projectId,
          });
        }

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
          owner: submissionOwner,
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
          compatibleIsAuthoritative: true,
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
          sourceFileVersionId: parameter.sourceFileVersionId,
          sourcePath: { kind: "property-path", value: parameter.sourceNodePath },
          invocation: submissionContext.invocation,
          requestId: submissionContext.requestId,
          refusalSink: submissionContext.refusalSink
        });

      }

      if (exactDraft && !exactDraft.ownerMatches) {
        throw new ApiError("FORBIDDEN", "Parameter draft owner does not match the trusted invocation.", {
          code: "parameter-draft-owner-mismatch",
          draftId: exactDraft.id,
          projectId: input.projectId,
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
      submitterUserId: submissionAttribution.userId,
      attribution: submissionAttribution,
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
            and initiator_type = $4
            and user_id is not distinct from $5
            and initiator_system_kind is not distinct from $6
            and initiator_system_name is not distinct from $7
          limit 1
          `
            : `
          select project_parameter_binding_id
          from parameter_drafts
          where organization_id = $1
            and project_id = $2
            and project_parameter_value_id = $3
            and initiator_type = $4
            and user_id is not distinct from $5
            and initiator_system_kind is not distinct from $6
            and initiator_system_name is not distinct from $7
          limit 1
          `,
          [
            auth.organization.id,
            input.projectId,
            parameter.id,
            submissionOwner.initiatorType,
            submissionOwner.userId,
            submissionOwner.systemKind,
            submissionOwner.systemName,
          ]
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
                owner: submissionOwner
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
        submitterUserId: submissionAttribution.userId,
        attribution: submissionAttribution,
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
          owner: submissionOwner,
          draftId: item.draftId
        });
      } else {
        await deleteDraftForParameter(tx, {
          organizationId: auth.organization.id,
          owner: submissionOwner,
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
        submitterUserId: submissionAttribution.userId,
        attribution: submissionAttribution,
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
        owner: submissionOwner,
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
        submitterName: trustedPublicExecutionLabel(submissionContext.invocation),
        reviewerUserIds: [workflowAssignees.hardwareCommitterId]
      });
    }

    return workflowAssignees ? { ...round, workflowAssignees, items } : { ...round, items };
  });
}

export async function listDrafts(
  db: Queryable,
  auth: AuthContext,
  query: DraftListQuery = {},
  context?: { invocation: TrustedInvocationContext }
) {
  requireCanView(auth);

  const invocation = context
    ? assertTrustedInvocationMatchesAuth(auth, context.invocation, "parameter draft list")
    : createUserInvocation(auth);
  const attribution = trustedDomainAttribution(invocation);

  return listDraftsForUser(db, {
    organizationId: auth.organization.id,
    owner: attribution,
    projectId: query.projectId
  });
}

export async function listSubmissionRounds(db: Queryable, auth: AuthContext, query: SubmissionRoundListQuery = {}) {
  requireCanView(auth);

  const organizationId = auth.organization.id;
  const rounds = await listSubmissionRoundRows(db, {
    organizationId,
    auth,
    projectId: query.projectId,
    status: query.status
  });

  if (rounds.length === 0) {
    return rounds;
  }

  const requestIds = [...new Set(rounds.flatMap((round) => round.items.map((item) => item.requestId)))];
  const [decisions, workflowStates] = await Promise.all([
    listReviewDecisionsForRequestIdsInternal(db, { organizationId, requestIds }),
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
    // Keep public workflow/history projections free of raw user identifiers
    // when the organization-scoped display lookup has no match.
    return userNames.get(userId) ?? "未知用户";
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
    auth,
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
    const initial = await loadChangeRequestForReview(tx, auth, input.requestId, false);
    const request = initial.editSubjectKind === "node-enablement" && initial.status === "software_merge" && input.decision === "advance"
      ? initial
      : await loadChangeRequestForReview(tx, auth, input.requestId);
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
    let reviewDecisions: Awaited<ReturnType<typeof listReviewDecisionsInternal>> = [];
    if (request.impact.some((item) => item.kind === "parameter" && item.risk === "High")) {
      reviewDecisions = await listReviewDecisionsInternal(tx, {
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
      reviewDecisions = await listReviewDecisionsInternal(tx, {
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
              name: "WiseEff Agent",
              action: "合入参数",
              note: mergeLink
            }
          : {
              role: "System 合入执行",
              name: `WiseEff System ${mergeInvocation.identity.kind}`,
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

    if (request.projectId) {
      const project = await getProjectById(tx, {
        organizationId: auth.organization.id,
        projectId: request.projectId
      });
      const mergeRecipientUserIds = [
        ...reviewDecisions
          .map((decision) => decision.reviewerUserId)
          .filter((userId): userId is string => Boolean(userId)),
        ...(request.workflowAssignees
          ? [
              request.workflowAssignees.hardwareCommitterId,
              request.workflowAssignees.softwareCommitterId,
              request.workflowAssignees.softwareUserId
            ]
          : [])
      ];
      await notifyParameterMergeCompleted(tx, {
        organizationId: auth.organization.id,
        projectId: request.projectId,
        projectName: project?.name,
        requestId: input.requestId,
        parameterName: request.title,
        submitterUserId: request.submitterUserId ?? null,
        execution: trustedMergeContext.invocation,
        reviewerUserIds: mergeRecipientUserIds
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

function legacyStructuralWriteRetirementError(): ApiError {
  const { error } = catalogLegacyGoneResponseSchema.parse(catalogLegacyGoneResult("", LEGACY_WRITE_GONE_MESSAGE).body);
  return new ApiError(error.code, error.message, error.details);
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
  if (kind !== "business") {
    throw legacyStructuralWriteRetirementError();
  }

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
  }

  const existing = await getParameterModuleByName(db, { organizationId, name, parentId });
  if (existing) {
    throw new ApiError("CONFLICT", "Parameter module already exists under this parent.", { name, parentId });
  }

  const sourceKey = null;

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
  }).catch((error: unknown) => {
    if (error instanceof pg.DatabaseError
      && error.code === "23505"
      && error.constraint === "parameter_modules_org_parent_name_unique_idx") {
      throw new ApiError("CONFLICT", "Parameter module already exists under this parent.", {
        name,
        parentId
      });
    }
    throw error;
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
  if (current.kind === "driver-group" || current.kind === "node-type") {
    throw legacyStructuralWriteRetirementError();
  }

  const nextName = body.name?.trim() ?? current.name;
  if (!nextName) {
    throw new ApiError("VALIDATION_FAILED", "Module name is required.");
  }

  const nextKind = body.kind ?? current.kind;
  if (body.kind !== undefined && body.kind !== current.kind) {
    throw legacyStructuralWriteRetirementError();
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
  }).catch((error: unknown) => {
    if (error instanceof pg.DatabaseError
      && error.code === "23505"
      && error.constraint === "parameter_modules_org_parent_name_unique_idx") {
      throw new ApiError("CONFLICT", "Parameter module already exists under this parent.", {
        name: nextName,
        parentId: current.parentId
      });
    }
    throw error;
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
  if (current.kind === "driver-group" || current.kind === "node-type") {
    throw legacyStructuralWriteRetirementError();
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
    if (error instanceof pg.DatabaseError
      && error.code === "23505"
      && error.constraint === "parameter_modules_org_parent_name_unique_idx") {
      throw new ApiError("CONFLICT", "Parameter module already exists under the target parent.", {
        name: nextName,
        parentId
      });
    }
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
  if (current.kind === "driver-group" || current.kind === "node-type") {
    throw legacyStructuralWriteRetirementError();
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
