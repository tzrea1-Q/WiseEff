import type {
  InitializationDraftDto,
  InitializationReviewDto,
  SemanticInitializationSnapshotItem
} from "@/domain/parameters/initializationTypes";
import type {
  ProjectParameterInitializationDraft,
  ProjectParameterInitializationReview,
  ProjectParameterInitializationSnapshotItem,
  RiskLevel
} from "@/domain/parameters/types";

function toLegacySnapshot(item: SemanticInitializationSnapshotItem): ProjectParameterInitializationSnapshotItem {
  return {
    parameterId: item.sourceProjectParameterBindingId || item.parameterSpecId,
    sourceProjectId: item.sourceProjectId,
    sourceRole: item.sourceRole,
    module: item.moduleId,
    risk: (item.risk ?? "Low") as RiskLevel,
    recommendedValue: item.rawValue,
    currentValueState: "pending_project_confirmation",
    alternativeSourceProjectIds: [],
    needsRecommendedValueConfirmation: item.needsEffectiveValueConfirmation,
    notes: item.notes
  };
}

/** Map semantic Port draft into legacy UI/reducer draft shape. */
export function toLegacyInitializationDraft(draft: InitializationDraftDto): ProjectParameterInitializationDraft {
  return {
    id: draft.id,
    projectId: draft.projectId,
    projectName: draft.projectName,
    projectCode: draft.projectCode,
    ownerUserId: draft.ownerUserId,
    sourceProjectIds: draft.sourceProjectIds,
    primarySourceProjectId: draft.primarySourceProjectId ?? "",
    supplementSourceProjectIds: draft.supplementSourceProjectIds,
    selectedModules: draft.selectedModuleIds,
    selectedRisks: draft.selectedRisks,
    selectedParameterIds: draft.selectedSourceBindingIds,
    parameterSnapshots: draft.bindingSnapshots.map(toLegacySnapshot),
    notes: draft.notes,
    createdBy: draft.createdByUserId,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt
  };
}

/** Map semantic Port review into legacy UI/reducer review shape. */
export function toLegacyInitializationReview(review: InitializationReviewDto): ProjectParameterInitializationReview {
  return {
    id: review.id,
    draftId: review.draftId,
    projectId: review.projectId,
    status: review.status,
    submittedBy: review.submittedByUserId,
    submittedAt: review.submittedAt,
    reviewedBy: review.reviewedByUserId,
    reviewedAt: review.reviewedAt,
    rejectionReason: review.rejectionReason
  };
}
