import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canEditParameters, canViewParameters } from "./policy";
import {
  createChangeRequest,
  createSubmissionItem,
  createSubmissionRound,
  deleteDraft as deleteDraftRow,
  deleteDraftForParameter,
  findOpenChangeRequest,
  getProjectParameterForUpdate,
  listChangeRequests as listChangeRequestRows,
  listDraftsForUser,
  listSubmissionRounds as listSubmissionRoundRows,
  upsertDraft
} from "./repository";
import type { ParameterChangeRequestStatus, ParameterSubmissionRoundStatus } from "./status";

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

function hasAssignees(input: SubmitParameterChangesInput) {
  return Boolean(
    input.assignees?.hardwareCommitterId || input.assignees?.softwareCommitterId || input.assignees?.softwareUserId
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

export async function saveDraft(db: Queryable, auth: AuthContext, input: SaveDraftInput) {
  requireCanEdit(auth);

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
        submitterUserId: auth.user.id
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

    return { ...round, items };
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
