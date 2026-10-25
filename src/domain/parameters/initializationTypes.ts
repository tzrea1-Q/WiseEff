/**
 * Semantic project-parameter initialization DTOs (API / Port).
 * Mirrors `server/modules/parameters/initializationTypes.ts`.
 * Legacy flat-library wizard shapes stay in `./types.ts`.
 */

export type ProjectInitializationStatus =
  | "not_initialized"
  | "initialization_draft"
  | "initialization_pending_review"
  | "initialization_rejected"
  | "initialized";

export type InitializationRiskLevel = "High" | "Medium" | "Low";

/** Server-derived, immutable preview of an independent private source copy. No source permissions or approvals. */
export type InitializationConfigSnapshot = {
  sourceProjectId: string;
  sourceConfigSetId: string;
  sourceConfigRevisionId: string | null;
  name: string;
  ownership: "private";
  digest: string;
  catalogReleaseId: string;
  members: Array<{ fileId: string; fileVersionId: string; checksum: string; sourceName: string; format: "dts" | "json"; sharedVersion: string | null }>;
};

/** Semantic binding snapshot item used by Port / HTTP client. */
export type SemanticInitializationSnapshotItem = {
  /** Stable id within the draft (not the target binding id). */
  id: string;
  sourceProjectId: string;
  sourceProjectParameterBindingId: string;
  /** Immutable canonical value selected for inheritance; binding id alone is not a source pin. */
  sourceProjectValueId: string;
  sourceRole: "primary" | "supplement";
  parameterSpecId: string;
  parameterSpecVersionId: string;
  propertyKey: string;
  /** Name from the source binding's immutable effective Definition revision. */
  displayName?: string;
  moduleId: string;
  risk: InitializationRiskLevel | null;
  /** Serializable effective value copied from source binding at snapshot time. */
  effectiveValue: unknown;
  rawValue: string;
  currentValueState: "pending_project_confirmation";
  alternativeSourceBindingIds: string[];
  alternativeSourceValueIds?: string[];
  sourceConfigSetId?: string;
  sourceConfigRevisionId?: string;
  sourceOccurrenceId?: string;
  sourceName?: string;
  sourceLocatorLabel?: string;
  sourceFormat?: "dts" | "json";
  needsEffectiveValueConfirmation: boolean;
  notes?: string;
};

/** @deprecated Prefer SemanticInitializationSnapshotItem — alias for server DTO name. */
export type InitializationSnapshotItemDto = SemanticInitializationSnapshotItem;

export type InitializationDraftDto = {
  sourceConfigSnapshots?: InitializationConfigSnapshot[];
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  ownerUserId: string | null;
  sourceProjectIds: string[];
  primarySourceProjectId: string | null;
  supplementSourceProjectIds: string[];
  selectedModuleIds: string[];
  selectedRisks: InitializationRiskLevel[];
  selectedSourceBindingIds: string[];
  bindingSnapshots: SemanticInitializationSnapshotItem[];
  emptyLibrary: boolean;
  notes: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InitializationReviewDto = {
  id: string;
  draftId: string;
  organizationId: string;
  projectId: string;
  status: "pending" | "approved" | "rejected";
  submittedByUserId: string | null;
  submittedByName?: string | null;
  submittedAt: string;
  reviewedByUserId?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string;
  rejectionReason?: string;
};

export type UpsertInitializationDraftInput = {
  sourceConfigSnapshots?: InitializationConfigSnapshot[];
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
  bindingSnapshots: SemanticInitializationSnapshotItem[];
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

export type ProjectInitializationStateDto = {
  status: ProjectInitializationStatus;
  draft: InitializationDraftDto | null;
};
