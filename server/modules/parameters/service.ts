import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canAdminParameters, canEditParameters, canMergeParameters, canReviewParameterStage, canViewParameters } from "./policy";
import {
  applyAddedImportItem,
  applyUpdatedImportItem,
  createChangeRequest,
  getImportBatchForUpdate,
  createSubmissionItem,
  createSubmissionRound,
  deleteDraft as deleteDraftRow,
  deleteDraftForParameter,
  findOpenChangeRequest,
  getChangeRequestById,
  getProjectById,
  getProjectParameterForUpdate,
  insertImportBatch,
  insertReviewDecision,
  listParameterDefinitionsForImport,
  listChangeRequests as listChangeRequestRows,
  listDraftsForUser,
  listReviewDecisions,
  listSubmissionRounds as listSubmissionRoundRows,
  markImportBatchApplied,
  mergeChangeRequest,
  type ParameterDefinitionImportCandidate,
  type PersistedImportBatchItem,
  updateChangeRequestStatus,
  updateSubmissionRoundStatusFromRequests,
  upsertDraft
} from "./repository";
import { applyImportBatchBodySchema, createImportBatchBodySchema } from "./schemas";
import { getNextParameterStatus, type ParameterChangeRequestStatus, type ParameterSubmissionRoundStatus } from "./status";
import type { ParameterImportSourceItemDto, ParameterImportSummaryDto } from "./types";

export type SaveDraftInput = {
  projectId: string;
  parameterId: string;
  targetValue: string;
  reason: string;
};

export type SubmitParameterChangesInput = {
  projectId: string;
  items: Array<{ parameterId: string; targetValue: string; reason: string }>;
  reason?: string;
  assignees?: {
    hardwareCommitterId?: string;
    softwareCommitterId?: string;
    softwareUserId?: string;
  };
};

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
};

export type ApplyImportBatchInput = {
  batchId: string;
  selectedItemIds?: string[];
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

function hasAssignees(input: SubmitParameterChangesInput) {
  return Boolean(
    input.assignees?.hardwareCommitterId || input.assignees?.softwareCommitterId || input.assignees?.softwareUserId
  );
}

function getCompleteWorkflowAssignees(input: SubmitParameterChangesInput) {
  const assignees = input.assignees;
  if (!assignees?.hardwareCommitterId || !assignees.softwareCommitterId || !assignees.softwareUserId) {
    return undefined;
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
  }
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
    metadata: {
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      note: input.note,
      expectedVersion: input.expectedVersion
    },
    traceId: randomUUID()
  });
}

async function createImportAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string;
    batchId: string;
    summary: { added: number; updated: number; skipped: number };
  }
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameter-management",
    kind: "batch-import",
    action: "apply",
    severity: "High",
    targetType: "parameter-import-batch",
    targetId: input.batchId,
    metadata: {
      batchId: input.batchId,
      summary: input.summary
    },
    traceId: randomUUID()
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
  return insertImportBatch(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: parsed.projectId,
    createdByUserId: auth.user.id,
    sourceName: parsed.sourceName,
    summary,
    items: previewItems
  });
}

export async function applyImportBatch(db: Database, auth: AuthContext, input: ApplyImportBatchInput) {
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
      }
    });

    return applied;
  });
}

export async function saveDraft(db: Queryable, auth: AuthContext, input: SaveDraftInput) {
  requireCanEdit(auth);
  await loadParameterForSubmission(db, auth, input.projectId, input.parameterId);

  return upsertDraft(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    parameterId: input.parameterId,
    userId: auth.user.id,
    targetValue: input.targetValue,
    reason: input.reason
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

export async function submitParameterChanges(db: Database, auth: AuthContext, input: SubmitParameterChangesInput) {
  requireCanEdit(auth);

  if (input.items.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "At least one parameter change is required.", 400);
  }
  assertUniqueSubmissionParameters(input.items);

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

      parameters.push({ item, parameter });
    }

    const status = hasAssignees(input) ? "hardware_review" : "submitted";
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
        assignedToUserId: input.assignees?.hardwareCommitterId,
        workflowAssignees: input.assignees
      });

      const submissionItem = await createSubmissionItem(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        submissionRoundId: round.id,
        changeRequestId: request.id,
        parameterId: parameter.id,
        currentValue: parameter.currentValue,
        targetValue: item.targetValue,
        reason: item.reason
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
      traceId: randomUUID()
    });

    const workflowAssignees = getCompleteWorkflowAssignees(input);
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

  return listSubmissionRoundRows(db, {
    organizationId: auth.organization.id,
    projectId: query.projectId,
    status: query.status
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

export async function reviewChange(db: Database, auth: AuthContext, input: ReviewParameterChangeInput) {
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
        note: input.note
      });

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
        note: input.note
      });

      return updated;
    }

    requireCanMerge(auth, request.projectId);

    if (request.impact.some((item) => item.kind === "parameter" && item.risk === "High")) {
      const decisions = await listReviewDecisions(tx, {
        organizationId: auth.organization.id,
        requestId: input.requestId
      });

      if (!hasHighRiskReviewEvidence(decisions)) {
        throw new ApiError(
          "CONFLICT",
          "High-risk parameter changes require hardware and software review before merge.",
          409,
          { requestId: input.requestId }
        );
      }
    }

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
      expectedVersion: input.expectedVersion
    });

    return updated;
  });
}
