import { randomUUID } from "node:crypto";

import type { AuditCorrelationContext } from "../audit/types";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  assertSourceProjectsOwned,
  getDraftByProject,
  getProjectInitializationStatus as loadProjectInitializationStatus,
  getReviewById,
  getReviewByIdForUpdate,
  insertReview,
  lockProjectInitialization,
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
import { canAdminParameters, canEditParameters, canViewParameters } from "../parameter-kernel/policy";
import type { TrustedInvocationContext } from "../auth/trustedInvocation";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import type { ObjectStore } from "../logs/objectStore";
import type { CatalogSnapshot } from "../catalog-kernel/interface";
import {
  cleanupCanonicalInitializationObjects,
  cloneCanonicalInitializationSource,
} from "../parameter-files/canonicalInitializationSource";

export type InitializationServiceContext = AuditCorrelationContext & {
  invocation?: TrustedInvocationContext;
  refusalSink?: TrustedRefusalAuditSink;
  objectStore?: ObjectStore;
  catalogSnapshot?: CatalogSnapshot;
};

function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  }
}

function requireCanEdit(auth: AuthContext, projectId?: string) {
  if (canEditParameters(auth, projectId)) return;
  const scopedOnly = projectId !== undefined && canEditParameters(auth);
  throw new ApiError(
    "FORBIDDEN",
    scopedOnly ? "Parameter edit role is required for this project." : "Parameter edit permission is required."
  );
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
  }
}

function validateDraftShape(input: UpsertInitializationDraftInput) {
  if (input.emptyLibrary) {
    if (input.sourceProjectIds.length > 0 || input.selectedSourceBindingIds.length > 0) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Empty-library initialization cannot include source projects or bindings."
      );
    }
    return;
  }

  if (input.sourceProjectIds.length === 0) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Select at least one source project, or explicitly start from an empty library."
    );
  }

  if (!input.primarySourceProjectId) {
    throw new ApiError("VALIDATION_FAILED", "A primary source project is required.");
  }

  if (!input.sourceProjectIds.includes(input.primarySourceProjectId)) {
    throw new ApiError("VALIDATION_FAILED", "Primary source must be included in source projects.");
  }
}

function validateSubmitDraft(draft: InitializationDraftDto) {
  if (draft.emptyLibrary) {
    if (draft.bindingSnapshots.length > 0) {
      throw new ApiError("VALIDATION_FAILED", "Empty-library draft must have zero binding snapshots.");
    }
    return;
  }

  if (draft.bindingSnapshots.length === 0) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Select at least one binding before submitting initialization for review."
    );
  }

  if (!draft.primarySourceProjectId) {
    throw new ApiError("VALIDATION_FAILED", "A primary source project is required before submit.");
  }
}

function toSnapshotItems(
  merged: ReturnType<typeof mergeInitializationBindingCandidates>
): InitializationSnapshotItemDto[] {
  return merged.map((item) => ({
    id: randomUUID(),
    sourceProjectId: item.sourceProjectId,
    sourceProjectParameterBindingId: item.sourceBindingId,
    sourceProjectValueId: item.sourceProjectValueId,
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
    alternativeSourceValueIds: item.alternativeSourceValueIds,
    sourceConfigSetId: item.sourceConfigSetId,
    sourceConfigRevisionId: item.sourceConfigRevisionId,
    sourceOccurrenceId: item.sourceOccurrenceId,
    sourceFormat: item.sourceFormat,
    sourceName: item.sourceName,
    sourceLocatorLabel: item.sourceLocatorLabel,
    needsEffectiveValueConfirmation: item.needsEffectiveValueConfirmation
  }));
}

function requireCanonicalApprovalContext(context: InitializationServiceContext) {
  if (!context.requestId?.trim() || !context.invocation || !context.refusalSink || !context.objectStore || !context.catalogSnapshot) {
    throw new ApiError("CONFLICT", "Canonical initialization approval requires trusted invocation, refusal, storage, and Catalog context.");
  }
  return {
    requestId: context.requestId,
    invocation: context.invocation,
    refusalSink: context.refusalSink,
    objectStore: context.objectStore,
    catalogSnapshot: context.catalogSnapshot
  };
}

function snapshotIdentity(item: InitializationSnapshotItemDto) {
  return [
    item.sourceProjectParameterBindingId,
    item.sourceProjectValueId,
    item.parameterSpecId,
    item.parameterSpecVersionId,
    item.sourceOccurrenceId ?? ""
  ].join("\u0000");
}

function requirePreviewSnapshotMatch(
  requested: InitializationSnapshotItemDto[],
  canonical: InitializationSnapshotItemDto[]
) {
  const expected = new Set(canonical.map(snapshotIdentity));
  const received = new Set(requested.map(snapshotIdentity));
  if (expected.size !== canonical.length || received.size !== requested.length
    || requested.length !== canonical.length || requested.some((item) => !expected.has(snapshotIdentity(item)))) {
    throw new ApiError("CONFLICT", "Initialization preview is stale; refresh canonical source choices before saving.");
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
    throw new ApiError("NOT_FOUND", "Project was not found.", { projectId });
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
    const existingStatus = await lockProjectInitialization(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId
    });
    if (!existingStatus) {
      throw new ApiError("NOT_FOUND", "Project was not found.", { projectId: input.projectId });
    }
    if (existingStatus === "initialization_pending_review" || existingStatus === "initialized") {
      throw new ApiError(
        "CONFLICT",
        "Initialization draft cannot be edited in the current project status.",
        { projectId: input.projectId, status: existingStatus }
      );
    }

    let persistedInput = input;
    if (!input.emptyLibrary) {
      await assertSourceProjectsOwned(tx, {
        organizationId: auth.organization.id,
        projectIds: input.sourceProjectIds,
      });
      const canonical = await previewSnapshot(tx, auth, {
        projectId: input.projectId,
        primarySourceProjectId: input.primarySourceProjectId,
        supplementSourceProjectIds: input.supplementSourceProjectIds,
        selectedSourceBindingIds: input.selectedSourceBindingIds,
        selectedModuleIds: input.selectedModuleIds,
        selectedRisks: input.selectedRisks,
      });
      requirePreviewSnapshotMatch(input.bindingSnapshots, canonical);
      persistedInput = { ...input, bindingSnapshots: canonical };
    }

    const existing = await getDraftByProject(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId
    });
    const draft = await upsertDraftInRepo(tx, {
      organizationId: auth.organization.id,
      id: existing?.id ?? randomUUID(),
      createdByUserId: auth.user.id,
      draft: persistedInput
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

  await assertSourceProjectsOwned(db, {
    organizationId: auth.organization.id,
    projectIds: [input.primarySourceProjectId, ...input.supplementSourceProjectIds],
  });

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

  const snapshots = toSnapshotItems(
    mergeInitializationBindingCandidates({
      primary,
      supplements
    })
  );
  if (input.selectedSourceBindingIds?.length) {
    const selected = new Set(input.selectedSourceBindingIds);
    const returned = new Set(snapshots.map((item) => item.sourceProjectParameterBindingId));
    if ([...selected].some((bindingId) => !returned.has(bindingId))) {
      throw new ApiError("CONFLICT", "A selected source Binding has no current canonical value and exact source pin.");
    }
  }
  return snapshots;
}

export async function submitDraft(
  db: Database,
  auth: AuthContext,
  input: { projectId: string },
  context: InitializationServiceContext = {}
): Promise<InitializationReviewDto> {
  requireCanEdit(auth, input.projectId);

  return db.transaction(async (tx) => {
    const status = await lockProjectInitialization(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId
    });
    if (!status) {
      throw new ApiError("NOT_FOUND", "Project was not found.", { projectId: input.projectId });
    }
    if (status === "initialization_pending_review" || status === "initialized") {
      throw new ApiError(
        "CONFLICT",
        "Initialization is already submitted or completed for this project.",
        { projectId: input.projectId, status }
      );
    }

    const draft = await getDraftByProject(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId
    });
    if (!draft) {
      throw new ApiError("NOT_FOUND", "Initialization draft was not found.", {
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
    // Every lifecycle mutation takes the project lock before the review lock.
    // This keeps approval/rejection ordered with draft upsert/submit and
    // prevents a submitted review from being paired with a later draft edit.
    const createdStorageKeys: string[] = [];
    let cleanupStore: ObjectStore | undefined;
    try {
    const reviewHint = await getReviewById(tx, {
      organizationId: auth.organization.id,
      reviewId: input.reviewId
    });
    if (!reviewHint) {
      throw new ApiError("NOT_FOUND", "Initialization review was not found.", {
        reviewId: input.reviewId
      });
    }
    const projectStatus = await lockProjectInitialization(tx, {
      organizationId: auth.organization.id,
      projectId: reviewHint.projectId
    });
    if (!projectStatus) {
      throw new ApiError("NOT_FOUND", "Project was not found.", { projectId: reviewHint.projectId });
    }
    const review = await getReviewByIdForUpdate(tx, {
      organizationId: auth.organization.id,
      reviewId: input.reviewId
    });
    if (!review) {
      throw new ApiError("NOT_FOUND", "Initialization review was not found.", {
        reviewId: input.reviewId
      });
    }
    if (review.status === "approved") {
      return review;
    }
    if (review.status !== "pending") {
      throw new ApiError("CONFLICT", "Initialization review is not pending approval.", {
        reviewId: input.reviewId,
        status: review.status
      });
    }

    const draft = await getDraftByProject(tx, {
      organizationId: auth.organization.id,
      projectId: review.projectId
    });
    if (!draft || draft.id !== review.draftId) {
      throw new ApiError("NOT_FOUND", "Initialization draft was not found for review.", {
        reviewId: input.reviewId,
        draftId: review.draftId
      });
    }

    if (!draft.emptyLibrary) {
      const canonical = requireCanonicalApprovalContext(context);
      cleanupStore = canonical.objectStore;
      await cloneCanonicalInitializationSource(tx, canonical.objectStore, auth, {
        targetProjectId: review.projectId,
        snapshots: draft.bindingSnapshots,
      }, { ...canonical, createdStorageKeys });
    }

    const approved = await markReviewApproved(tx, {
      organizationId: auth.organization.id,
      reviewId: input.reviewId,
      reviewedByUserId: auth.user.id
    });
    if (!approved) {
      throw new ApiError("CONFLICT", "Initialization review is not pending approval.", {
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
    } catch (error) {
      if (cleanupStore) {
        await cleanupCanonicalInitializationObjects(cleanupStore, createdStorageKeys, error);
      }
      throw error;
    }
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
    throw new ApiError("VALIDATION_FAILED", "Rejection reason is required.");
  }

  return db.transaction(async (tx) => {
    // Match approval's project -> review lock order so reject cannot race a
    // draft upsert or deadlock with an in-flight approval.
    const reviewHint = await getReviewById(tx, {
      organizationId: auth.organization.id,
      reviewId: input.reviewId
    });
    if (!reviewHint) {
      throw new ApiError("NOT_FOUND", "Initialization review was not found.", {
        reviewId: input.reviewId
      });
    }
    const projectStatus = await lockProjectInitialization(tx, {
      organizationId: auth.organization.id,
      projectId: reviewHint.projectId
    });
    if (!projectStatus) {
      throw new ApiError("NOT_FOUND", "Project was not found.", { projectId: reviewHint.projectId });
    }
    const review = await getReviewByIdForUpdate(tx, {
      organizationId: auth.organization.id,
      reviewId: input.reviewId
    });
    if (!review) {
      throw new ApiError("NOT_FOUND", "Initialization review was not found.", {
        reviewId: input.reviewId
      });
    }
    if (review.status !== "pending") {
      throw new ApiError("CONFLICT", "Initialization review is not pending.", {
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
      throw new ApiError("CONFLICT", "Initialization review is not pending.", {
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
    throw new ApiError("NOT_FOUND", "Project was not found.", { projectId });
  }
  if (status !== "initialized") {
    throw new ApiError(
      "CONFLICT",
      "Project parameter changes are locked until initialization is approved.",
      { projectId, initializationStatus: status }
    );
  }
}
