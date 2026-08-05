export type ProjectInitializationStatus =
  | "not_initialized"
  | "initialization_draft"
  | "initialization_pending_review"
  | "initialization_rejected"
  | "initialized";

export type InitializationRiskLevel = "High" | "Medium" | "Low";

export type InitializationSnapshotItemDto = {
  /** Stable id within the draft (not the target binding id). */
  id: string;
  sourceProjectId: string;
  sourceProjectParameterBindingId: string;
  sourceRole: "primary" | "supplement";
  parameterSpecId: string;
  parameterSpecVersionId: string;
  propertyKey: string;
  moduleId: string;
  risk: InitializationRiskLevel | null;
  /** Serializable effective value copied from source binding at snapshot time. */
  effectiveValue: unknown;
  rawValue: string;
  currentValueState: "pending_project_confirmation";
  alternativeSourceBindingIds: string[];
  needsEffectiveValueConfirmation: boolean;
  notes?: string;
};

export type InitializationDraftDto = {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  ownerUserId: string;
  sourceProjectIds: string[];
  primarySourceProjectId: string | null;
  supplementSourceProjectIds: string[];
  selectedModuleIds: string[];
  selectedRisks: InitializationRiskLevel[];
  selectedSourceBindingIds: string[];
  bindingSnapshots: InitializationSnapshotItemDto[];
  emptyLibrary: boolean;
  notes: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type InitializationReviewDto = {
  id: string;
  draftId: string;
  organizationId: string;
  projectId: string;
  status: "pending" | "approved" | "rejected";
  submittedByUserId: string;
  submittedAt: string;
  reviewedByUserId?: string;
  reviewedAt?: string;
  rejectionReason?: string;
};

export type UpsertInitializationDraftInput = {
  projectId: string;
  projectName: string;
  projectCode: string;
  ownerUserId: string;
  sourceProjectIds: string[];
  primarySourceProjectId: string | null;
  supplementSourceProjectIds: string[];
  selectedModuleIds: string[];
  selectedRisks: InitializationRiskLevel[];
  selectedSourceBindingIds: string[];
  bindingSnapshots: InitializationSnapshotItemDto[];
  emptyLibrary: boolean;
  notes: string;
};

export type PreviewInitializationSnapshotInput = {
  projectId: string;
  primarySourceProjectId: string | null;
  supplementSourceProjectIds: string[];
  selectedSourceBindingIds?: string[];
  selectedModuleIds?: string[];
  selectedRisks?: InitializationRiskLevel[];
};
