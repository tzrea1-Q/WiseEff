import type { ParameterInitializationRepository } from "@/application/ports/ParameterInitializationRepository";
import type {
  InitializationDraftDto,
  InitializationReviewDto,
  ProjectInitializationStatus,
  SemanticInitializationSnapshotItem,
  UpsertInitializationDraftInput
} from "@/domain/parameters/initializationTypes";

const MOCK_NOW = "2026-08-05T12:00:00.000Z";

export type MockParameterInitializationSeed = {
  statuses?: Record<string, ProjectInitializationStatus>;
  drafts?: InitializationDraftDto[];
  reviews?: InitializationReviewDto[];
  organizationId?: string;
  actorUserId?: string;
};

function cloneDraft(draft: InitializationDraftDto): InitializationDraftDto {
  return {
    ...draft,
    sourceProjectIds: [...draft.sourceProjectIds],
    supplementSourceProjectIds: [...draft.supplementSourceProjectIds],
    selectedModuleIds: [...draft.selectedModuleIds],
    selectedRisks: [...draft.selectedRisks],
    selectedSourceBindingIds: [...draft.selectedSourceBindingIds],
    bindingSnapshots: draft.bindingSnapshots.map((item) => ({
      ...item,
      alternativeSourceBindingIds: [...item.alternativeSourceBindingIds]
    }))
  };
}

function cloneReview(review: InitializationReviewDto): InitializationReviewDto {
  return { ...review };
}

function draftFromInput(
  input: UpsertInitializationDraftInput,
  existing: InitializationDraftDto | undefined,
  organizationId: string,
  actorUserId: string
): InitializationDraftDto {
  return {
    id: existing?.id ?? `init-draft-${input.projectId}`,
    organizationId,
    projectId: input.projectId,
    projectName: input.projectName,
    projectCode: input.projectCode,
    ownerUserId: input.ownerUserId,
    sourceProjectIds: [...input.sourceProjectIds],
    primarySourceProjectId: input.primarySourceProjectId,
    supplementSourceProjectIds: [...input.supplementSourceProjectIds],
    selectedModuleIds: [...input.selectedModuleIds],
    selectedRisks: [...input.selectedRisks],
    selectedSourceBindingIds: [...input.selectedSourceBindingIds],
    bindingSnapshots: input.bindingSnapshots.map((item) => ({
      ...item,
      alternativeSourceBindingIds: [...item.alternativeSourceBindingIds]
    })),
    emptyLibrary: input.emptyLibrary,
    notes: input.notes,
    createdByUserId: existing?.createdByUserId ?? actorUserId,
    createdAt: existing?.createdAt ?? MOCK_NOW,
    updatedAt: MOCK_NOW
  };
}

/**
 * Honest in-memory adapter: status transitions, drafts, and reviews mutate store state.
 */
export function createMockParameterInitializationRepository(
  seed: MockParameterInitializationSeed = {}
): ParameterInitializationRepository {
  const organizationId = seed.organizationId ?? "org-mock";
  const actorUserId = seed.actorUserId ?? "user-mock";
  const statuses = new Map<string, ProjectInitializationStatus>(Object.entries(seed.statuses ?? {}));
  const drafts = new Map<string, InitializationDraftDto>(
    (seed.drafts ?? []).map((draft) => [draft.projectId, cloneDraft(draft)])
  );
  let reviews = (seed.reviews ?? []).map(cloneReview);
  let reviewCounter = reviews.length;

  function requireStatus(projectId: string): ProjectInitializationStatus {
    const status = statuses.get(projectId) ?? "not_initialized";
    statuses.set(projectId, status);
    return status;
  }

  return {
    async getInitialization(projectId) {
      const draft = drafts.get(projectId);
      return {
        status: requireStatus(projectId),
        draft: draft ? cloneDraft(draft) : null
      };
    },

    async upsertDraft(input) {
      const status = requireStatus(input.projectId);
      if (status === "initialization_pending_review" || status === "initialized") {
        throw new Error(`Initialization draft cannot be edited while status is ${status}.`);
      }
      if (input.emptyLibrary) {
        if (
          input.sourceProjectIds.length > 0 ||
          input.primarySourceProjectId ||
          input.bindingSnapshots.length > 0 ||
          input.selectedSourceBindingIds.length > 0
        ) {
          throw new Error("Empty-library initialization cannot include source projects or bindings.");
        }
      }
      const next = draftFromInput(input, drafts.get(input.projectId), organizationId, actorUserId);
      drafts.set(input.projectId, next);
      statuses.set(input.projectId, "initialization_draft");
      return cloneDraft(next);
    },

    async previewSnapshot(input) {
      if (!input.primarySourceProjectId) {
        return [];
      }
      const selected = new Set(input.selectedSourceBindingIds ?? []);
      const draft = drafts.get(input.projectId);
      const fromDraft = draft?.bindingSnapshots ?? [];
      const items: SemanticInitializationSnapshotItem[] = fromDraft.filter((item) => {
        if (selected.size > 0 && !selected.has(item.sourceProjectParameterBindingId)) {
          return false;
        }
        if (item.sourceProjectId !== input.primarySourceProjectId) {
          return input.supplementSourceProjectIds.includes(item.sourceProjectId);
        }
        return true;
      });
      if (items.length > 0) {
        return items.map((item) => ({
          ...item,
          alternativeSourceBindingIds: [...item.alternativeSourceBindingIds]
        }));
      }
      // Deterministic placeholder candidates when no draft snapshots exist yet.
      return [
        {
          id: `preview-${input.primarySourceProjectId}`,
          sourceProjectId: input.primarySourceProjectId,
          sourceProjectParameterBindingId: `binding-${input.primarySourceProjectId}`,
          sourceRole: "primary",
          parameterSpecId: "spec-preview",
          parameterSpecVersionId: "spec-version-preview",
          propertyKey: "preview_key",
          moduleId: "module-preview",
          risk: "Medium",
          effectiveValue: null,
          rawValue: "",
          currentValueState: "pending_project_confirmation",
          alternativeSourceBindingIds: [],
          needsEffectiveValueConfirmation: true
        }
      ];
    },

    async submit(projectId) {
      const status = requireStatus(projectId);
      if (status === "initialization_pending_review" || status === "initialized") {
        throw new Error(`Initialization cannot be submitted while status is ${status}.`);
      }
      const draft = drafts.get(projectId);
      if (!draft) {
        throw new Error(`Initialization draft not found for project ${projectId}.`);
      }
      if (!draft.emptyLibrary && draft.bindingSnapshots.length === 0) {
        throw new Error("Select at least one binding before submitting initialization for review.");
      }
      if (reviews.some((review) => review.projectId === projectId && review.status === "pending")) {
        throw new Error(`Project ${projectId} already has a pending initialization review.`);
      }
      reviewCounter += 1;
      const review: InitializationReviewDto = {
        id: `PIR-mock-${reviewCounter}`,
        draftId: draft.id,
        organizationId,
        projectId,
        status: "pending",
        submittedByUserId: actorUserId,
        submittedAt: MOCK_NOW
      };
      reviews = [review, ...reviews];
      statuses.set(projectId, "initialization_pending_review");
      return cloneReview(review);
    },

    async listPendingReviews() {
      return reviews.filter((review) => review.status === "pending").map(cloneReview);
    },

    async approve(reviewId) {
      const review = reviews.find((item) => item.id === reviewId);
      if (!review || review.status !== "pending") {
        throw new Error(`Pending initialization review not found: ${reviewId}`);
      }
      const draft = drafts.get(review.projectId);
      if (!draft || draft.id !== review.draftId) {
        throw new Error(`Initialization draft not found for review ${reviewId}`);
      }
      // Empty library: no bindings to materialize — status alone unlocks the project.
      const approved: InitializationReviewDto = {
        ...review,
        status: "approved",
        reviewedByUserId: actorUserId,
        reviewedAt: MOCK_NOW
      };
      reviews = reviews.map((item) => (item.id === reviewId ? approved : item));
      statuses.set(review.projectId, "initialized");
      return cloneReview(approved);
    },

    async reject(reviewId, reason) {
      const trimmed = reason.trim();
      if (!trimmed) {
        throw new Error("Rejection reason is required.");
      }
      const review = reviews.find((item) => item.id === reviewId);
      if (!review || review.status !== "pending") {
        throw new Error(`Pending initialization review not found: ${reviewId}`);
      }
      const rejected: InitializationReviewDto = {
        ...review,
        status: "rejected",
        reviewedByUserId: actorUserId,
        reviewedAt: MOCK_NOW,
        rejectionReason: trimmed
      };
      reviews = reviews.map((item) => (item.id === reviewId ? rejected : item));
      statuses.set(review.projectId, "initialization_rejected");
      return cloneReview(rejected);
    }
  };
}
