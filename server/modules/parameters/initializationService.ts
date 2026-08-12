import { randomUUID } from "node:crypto";

import type { AuditCorrelationContext } from "../audit/types";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { getConfigSetByProjectAndName } from "../parameter-files/configSetRepository";
import { createOrReuseBinding, upsertBindingRevisionValues } from "../parameter-topology/bindingService";
import {
  getLatestConfigRevision,
  insertConfigRevision,
  nextConfigRevisionNumber
} from "../parameter-topology/repository";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  getBindingLogicalNodeId,
  getDraftByProject,
  getProjectInitializationStatus as loadProjectInitializationStatus,
  getReviewById,
  insertReview,
  listPendingReviews as listPendingReviewsFromRepo,
  listSourceBindingCandidates,
  markReviewApproved,
  markReviewRejected,
  setProjectInitializationStatus,
  upsertDraft as upsertDraftInRepo
} from "./initializationRepository";
import type {
  InitializationDraftDto,
  InitializationReviewDto,
  InitializationSnapshotItemDto,
  PreviewInitializationSnapshotInput,
  ProjectInitializationStatus,
  UpsertInitializationDraftInput
} from "./initializationTypes";
import { mergeInitializationBindingCandidates } from "./mergeInitializationBindings";
import { canAdminParameters, canEditParameters, canViewParameters } from "./policy";

export type InitializationServiceContext = AuditCorrelationContext;

function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
  }
}

function requireCanEdit(auth: AuthContext, projectId?: string) {
  if (canEditParameters(auth, projectId)) return;
  const scopedOnly = projectId !== undefined && canEditParameters(auth);
  throw new ApiError(
    "FORBIDDEN",
    scopedOnly ? "Parameter edit role is required for this project." : "Parameter edit permission is required.",
    403
  );
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.", 403);
  }
}

function validateDraftShape(input: UpsertInitializationDraftInput) {
  if (input.emptyLibrary) {
    if (input.sourceProjectIds.length > 0 || input.selectedSourceBindingIds.length > 0) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Empty-library initialization cannot include source projects or bindings.",
        400
      );
    }
    return;
  }

  if (input.sourceProjectIds.length === 0) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Select at least one source project, or explicitly start from an empty library.",
      400
    );
  }

  if (!input.primarySourceProjectId) {
    throw new ApiError("VALIDATION_FAILED", "A primary source project is required.", 400);
  }

  if (!input.sourceProjectIds.includes(input.primarySourceProjectId)) {
    throw new ApiError("VALIDATION_FAILED", "Primary source must be included in source projects.", 400);
  }
}

function validateSubmitDraft(draft: InitializationDraftDto) {
  if (draft.emptyLibrary) {
    if (draft.bindingSnapshots.length > 0) {
      throw new ApiError("VALIDATION_FAILED", "Empty-library draft must have zero binding snapshots.", 400);
    }
    return;
  }

  if (draft.bindingSnapshots.length === 0) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Select at least one binding before submitting initialization for review.",
      400
    );
  }

  if (!draft.primarySourceProjectId) {
    throw new ApiError("VALIDATION_FAILED", "A primary source project is required before submit.", 400);
  }
}

function toSnapshotItems(
  merged: ReturnType<typeof mergeInitializationBindingCandidates>
): InitializationSnapshotItemDto[] {
  return merged.map((item) => ({
    id: randomUUID(),
    sourceProjectId: item.sourceProjectId,
    sourceProjectParameterBindingId: item.sourceBindingId,
    sourceRole: item.sourceRole,
    parameterSpecId: item.parameterSpecId,
    parameterSpecVersionId: item.parameterSpecVersionId,
    propertyKey: item.propertyKey,
    moduleId: item.moduleId,
    risk: item.risk,
    effectiveValue: item.effectiveValue,
    rawValue: item.rawValue,
    currentValueState: item.currentValueState,
    alternativeSourceBindingIds: item.alternativeSourceBindingIds,
    needsEffectiveValueConfirmation: item.needsEffectiveValueConfirmation
  }));
}

async function ensureTargetConfigRevision(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    createdByUserId: string;
  }
) {
  const configSet = await getConfigSetByProjectAndName(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    name: "default"
  });
  if (!configSet) {
    throw new ApiError(
      "CONFLICT",
      "Default config set is required before materializing initialization bindings.",
      409,
      { projectId: input.projectId }
    );
  }

  const latest = await getLatestConfigRevision(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    configSetId: configSet.id
  });
  if (latest) {
    return latest;
  }

  const revisionNumber = await nextConfigRevisionNumber(db, configSet.id);
  return insertConfigRevision(db, {
    id: randomUUID(),
    organizationId: input.organizationId,
    projectId: input.projectId,
    configSetId: configSet.id,
    revisionNumber,
    status: "draft",
    createdByUserId: input.createdByUserId
  });
}

async function materializeSnapshots(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    createdByUserId: string;
    snapshots: InitializationSnapshotItemDto[];
  }
) {
  if (input.snapshots.length === 0) return;

  const revision = await ensureTargetConfigRevision(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    createdByUserId: input.createdByUserId
  });

  for (const snapshot of input.snapshots) {
    if (!snapshot.parameterSpecId || !snapshot.moduleId || !snapshot.parameterSpecVersionId) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Initialization snapshot is missing required binding identity fields.",
        400,
        { snapshotId: snapshot.id }
      );
    }

    const logicalNodeId = await getBindingLogicalNodeId(db, {
      organizationId: input.organizationId,
      bindingId: snapshot.sourceProjectParameterBindingId
    });

    const binding = await createOrReuseBinding(db, {
      organizationId: input.organizationId,
      key: {
        projectId: input.projectId,
        logicalNodeId,
        parameterSpecId: snapshot.parameterSpecId,
        moduleId: snapshot.moduleId
      }
    });

    const typedValue =
      snapshot.effectiveValue ??
      ({ kind: "raw", rawText: snapshot.rawValue } satisfies { kind: "raw"; rawText: string });

    await upsertBindingRevisionValues(db, {
      bindingId: binding.id,
      configRevisionId: revision.id,
      parameterSpecVersionId: snapshot.parameterSpecVersionId,
      values: {
        typedValue,
        canonicalValue: snapshot.effectiveValue ?? undefined,
        rawValue: snapshot.rawValue,
        schemaState: "initialized"
      },
      tenant: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        configRevisionId: revision.id
      }
    });
  }
}

export async function getProjectInitializationStatus(
  db: Queryable,
  auth: AuthContext,
  projectId: string
): Promise<ProjectInitializationStatus> {
  requireCanView(auth);
  const status = await loadProjectInitializationStatus(db, {
    organizationId: auth.organization.id,
    projectId
  });
  if (!status) {
    throw new ApiError("NOT_FOUND", "Project was not found.", 404, { projectId });
  }
  return status;
}

export async function upsertDraft(
  db: Database,
  auth: AuthContext,
  input: UpsertInitializationDraftInput,
  context: InitializationServiceContext = {}
): Promise<InitializationDraftDto> {
  requireCanEdit(auth, input.projectId);
  validateDraftShape(input);

  return db.transaction(async (tx) => {
    const existingStatus = await loadProjectInitializationStatus(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId
    });
    if (!existingStatus) {
      throw new ApiError("NOT_FOUND", "Project was not found.", 404, { projectId: input.projectId });
    }
    if (existingStatus === "initialization_pending_review" || existingStatus === "initialized") {
      throw new ApiError(
        "CONFLICT",
        "Initialization draft cannot be edited in the current project status.",
        409,
        { projectId: input.projectId, status: existingStatus }
      );
    }

    const existing = await getDraftByProject(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId
    });
    const draft = await upsertDraftInRepo(tx, {
      organizationId: auth.organization.id,
      id: existing?.id ?? randomUUID(),
      createdByUserId: auth.user.id,
      draft: input
    });

    await setProjectInitializationStatus(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      status: "initialization_draft"
    });

    void context;
    return draft;
  });
}

export async function previewSnapshot(
  db: Queryable,
  auth: AuthContext,
  input: PreviewInitializationSnapshotInput
): Promise<InitializationSnapshotItemDto[]> {
  requireCanEdit(auth, input.projectId);

  if (!input.primarySourceProjectId) {
    return [];
  }

  const supplementIds = input.supplementSourceProjectIds.filter((id) => id !== input.primarySourceProjectId);
  const primary = await listSourceBindingCandidates(db, {
    organizationId: auth.organization.id,
    projectIds: [input.primarySourceProjectId],
    bindingIds: input.selectedSourceBindingIds,
    moduleIds: input.selectedModuleIds,
    risks: input.selectedRisks
  });

  const supplements = [];
  for (const projectId of supplementIds) {
    supplements.push(
      await listSourceBindingCandidates(db, {
        organizationId: auth.organization.id,
        projectIds: [projectId],
        bindingIds: input.selectedSourceBindingIds,
        moduleIds: input.selectedModuleIds,
        risks: input.selectedRisks
      })
    );
  }

  return toSnapshotItems(
    mergeInitializationBindingCandidates({
      primary,
      supplements
    })
  );
}

export async function submitDraft(
  db: Database,
  auth: AuthContext,
  input: { projectId: string },
  context: InitializationServiceContext = {}
): Promise<InitializationReviewDto> {
  requireCanEdit(auth, input.projectId);

  return db.transaction(async (tx) => {
    const status = await loadProjectInitializationStatus(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId
    });
    if (!status) {
      throw new ApiError("NOT_FOUND", "Project was not found.", 404, { projectId: input.projectId });
    }
    if (status === "initialization_pending_review" || status === "initialized") {
      throw new ApiError(
        "CONFLICT",
        "Initialization is already submitted or completed for this project.",
        409,
        { projectId: input.projectId, status }
      );
    }

    const draft = await getDraftByProject(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId
    });
    if (!draft) {
      throw new ApiError("NOT_FOUND", "Initialization draft was not found.", 404, {
        projectId: input.projectId
      });
    }

    validateSubmitDraft(draft);

    const review = await insertReview(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      projectId: input.projectId,
      draftId: draft.id,
      submittedByUserId: auth.user.id
    });

    await setProjectInitializationStatus(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      status: "initialization_pending_review"
    });

    await writeAuditEventInTx(asAuditTx(tx), auth, { requestId: context.requestId ?? randomUUID() }, {
      app: "parameter-admin",
      kind: "project-initialization-submitted",
      action: "submit",
      severity: "Medium",
      projectId: input.projectId,
      targetType: "project-parameter-initialization-review",
      targetId: review.id,
      metadata: {
        draftId: draft.id,
        reviewId: review.id,
        projectId: input.projectId,
        emptyLibrary: draft.emptyLibrary,
        bindingCount: draft.bindingSnapshots.length,
        sourceProjectIds: draft.sourceProjectIds
      }
    });

    return review;
  });
}

export async function listPendingReviews(
  db: Queryable,
  auth: AuthContext
): Promise<InitializationReviewDto[]> {
  requireCanAdmin(auth);
  return listPendingReviewsFromRepo(db, { organizationId: auth.organization.id });
}

export async function approveReview(
  db: Database,
  auth: AuthContext,
  input: { reviewId: string },
  context: InitializationServiceContext = {}
): Promise<InitializationReviewDto> {
  requireCanAdmin(auth);

  return db.transaction(async (tx) => {
    const review = await getReviewById(tx, {
      organizationId: auth.organization.id,
      reviewId: input.reviewId
    });
    if (!review) {
      throw new ApiError("NOT_FOUND", "Initialization review was not found.", 404, {
        reviewId: input.reviewId
      });
    }
    if (review.status !== "pending") {
      throw new ApiError("CONFLICT", "Initialization review is not pending approval.", 409, {
        reviewId: input.reviewId,
        status: review.status
      });
    }

    const draft = await getDraftByProject(tx, {
      organizationId: auth.organization.id,
      projectId: review.projectId
    });
    if (!draft || draft.id !== review.draftId) {
      throw new ApiError("NOT_FOUND", "Initialization draft was not found for review.", 404, {
        reviewId: input.reviewId,
        draftId: review.draftId
      });
    }

    if (!draft.emptyLibrary) {
      await materializeSnapshots(tx, {
        organizationId: auth.organization.id,
        projectId: review.projectId,
        createdByUserId: auth.user.id,
        snapshots: draft.bindingSnapshots
      });
    }

    const approved = await markReviewApproved(tx, {
      organizationId: auth.organization.id,
      reviewId: input.reviewId,
      reviewedByUserId: auth.user.id
    });
    if (!approved) {
      throw new ApiError("CONFLICT", "Initialization review is not pending approval.", 409, {
        reviewId: input.reviewId
      });
    }

    await setProjectInitializationStatus(tx, {
      organizationId: auth.organization.id,
      projectId: review.projectId,
      status: "initialized"
    });

    await writeAuditEventInTx(asAuditTx(tx), auth, { requestId: context.requestId ?? randomUUID() }, {
      app: "parameter-admin",
      kind: "project-initialization-approved",
      action: "approve",
      severity: "Medium",
      projectId: review.projectId,
      targetType: "project-parameter-initialization-review",
      targetId: approved.id,
      metadata: {
        draftId: draft.id,
        reviewId: approved.id,
        projectId: review.projectId,
        emptyLibrary: draft.emptyLibrary,
        bindingCount: draft.bindingSnapshots.length
      }
    });

    return approved;
  });
}

export async function rejectReview(
  db: Database,
  auth: AuthContext,
  input: { reviewId: string; reason: string },
  context: InitializationServiceContext = {}
): Promise<InitializationReviewDto> {
  requireCanAdmin(auth);

  const reason = input.reason.trim();
  if (!reason) {
    throw new ApiError("VALIDATION_FAILED", "Rejection reason is required.", 400);
  }

  return db.transaction(async (tx) => {
    const review = await getReviewById(tx, {
      organizationId: auth.organization.id,
      reviewId: input.reviewId
    });
    if (!review) {
      throw new ApiError("NOT_FOUND", "Initialization review was not found.", 404, {
        reviewId: input.reviewId
      });
    }
    if (review.status !== "pending") {
      throw new ApiError("CONFLICT", "Initialization review is not pending.", 409, {
        reviewId: input.reviewId,
        status: review.status
      });
    }

    // Keep draft row editable after reject (status moves back to rejected lifecycle).
    await getDraftByProject(tx, {
      organizationId: auth.organization.id,
      projectId: review.projectId
    });

    const rejected = await markReviewRejected(tx, {
      organizationId: auth.organization.id,
      reviewId: input.reviewId,
      reviewedByUserId: auth.user.id,
      rejectionReason: reason
    });
    if (!rejected) {
      throw new ApiError("CONFLICT", "Initialization review is not pending.", 409, {
        reviewId: input.reviewId
      });
    }

    await setProjectInitializationStatus(tx, {
      organizationId: auth.organization.id,
      projectId: review.projectId,
      status: "initialization_rejected"
    });

    await writeAuditEventInTx(asAuditTx(tx), auth, { requestId: context.requestId ?? randomUUID() }, {
      app: "parameter-admin",
      kind: "project-initialization-rejected",
      action: "reject",
      severity: "Medium",
      projectId: review.projectId,
      targetType: "project-parameter-initialization-review",
      targetId: rejected.id,
      metadata: {
        draftId: review.draftId,
        reviewId: rejected.id,
        projectId: review.projectId,
        reason
      }
    });

    return rejected;
  });
}

export async function assertProjectAllowsParameterSubmit(
  db: Queryable,
  organizationId: string,
  projectId: string
): Promise<void> {
  const status = await loadProjectInitializationStatus(db, { organizationId, projectId });
  if (status === null) {
    throw new ApiError("NOT_FOUND", "Project was not found.", 404, { projectId });
  }
  if (status !== "initialized") {
    throw new ApiError(
      "CONFLICT",
      "Project parameter changes are locked until initialization is approved.",
      409,
      { projectId, initializationStatus: status }
    );
  }
}
