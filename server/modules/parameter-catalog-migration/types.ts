/**
 * Definition identity correction migration (#847) — command, result and failure
 * vocabulary.
 *
 * This module coordinates capabilities that already own their own transaction
 * boundaries: typed authoring / complete-successor build / Candidate /
 * Authorization / publication job (`catalog-publication`), Catalog
 * materialization (`catalog-kernel`), organization registration
 * (`parameter-governance`), source-preserving property-key rewrite
 * (`parameter-specs`), and immutable ProjectValue mutation
 * (`parameter-bindings`).  It never authors Catalog truth itself.
 */
import { randomUUID } from "node:crypto";

import type {
  CatalogReleasePin,
  ContractJsonValue,
} from "../parameter-catalog-contract/index";
import type { SupportedDefinitionContent } from "../catalog-publication/builder/types";

export type DefinitionReplacementId = string;
export type DefinitionReplacementPreviewId = string;

export const DEFINITION_REPLACEMENT_EXECUTE_FAMILY = "definition-replacement-execute";
export const DEFINITION_REPLACEMENT_CONTINUE_FAMILY = "definition-replacement-continue";

export const DEFINITION_REPLACEMENT_PREVIEW_TTL_MS = 30 * 60 * 1000;

/** Maximum projects a single approved manifest may name (frozen DTO max). */
export const DEFINITION_REPLACEMENT_MAX_PROJECTS = 200;

export type TrustedMigrationContext =
  | { readonly actorKind: "org-admin"; readonly principalId: string; readonly organizationId: string }
  | { readonly actorKind: "platform-admin"; readonly principalId: string }
  | { readonly actorKind: "agent"; readonly principalId: string }
  | { readonly actorKind: "org-member"; readonly principalId: string; readonly organizationId: string };

export type ReplacementProjectStatus = "completed" | "blocked" | "failed" | "pending";
export type ReplacementStatus = "pending" | "executing" | "completed" | "blocked" | "failed";

export type PreviewDefinitionReplacementCommand = {
  readonly organizationId: string;
  readonly oldDefinitionId: string;
  readonly newSubjectId: string;
  readonly newPropertyKey: string;
  readonly proposedContent: SupportedDefinitionContent;
  readonly projectIds: readonly string[];
  readonly reason: string;
  readonly expectedRelease: CatalogReleasePin;
  readonly context: TrustedMigrationContext;
};

export type CreateDefinitionReplacementCommand = {
  readonly organizationId: string;
  readonly previewId: DefinitionReplacementPreviewId;
  readonly previewFingerprint: string;
  readonly idempotencyKey: string;
  readonly expectedRelease: CatalogReleasePin;
  readonly context: TrustedMigrationContext;
  /** Trusted invocation brand for the authenticated principal, when composable. */
  readonly trustedActor?: import("../auth/trustedInvocation").TrustedInvocationContext;
};

export type ContinueDefinitionReplacementCommand = {
  readonly organizationId: string;
  readonly replacementId: DefinitionReplacementId;
  readonly projectIds: readonly string[] | null;
  readonly idempotencyKey: string;
  readonly expectedRelease: CatalogReleasePin;
  readonly context: TrustedMigrationContext;
};

export type GetDefinitionReplacementQuery = {
  readonly organizationId: string;
  readonly replacementId: DefinitionReplacementId;
};

export type ListDefinitionReplacementsQuery = {
  readonly organizationId: string;
};

/** The frozen per-project evidence a preview computed. */
export type FrozenProjectTip = {
  readonly projectId: string;
  readonly bindingId: string;
  readonly logicalNodeId: string;
  readonly currentValueId: string;
  readonly configRevisionId: string;
  readonly sourceRef: string;
  /**
   * The source location the corrected value should carry.  Equals `sourceRef`
   * for a key-less `.dts` location; for a key-bearing recorded ref it is the
   * same path with the property key substituted.  Frozen with the preview so a
   * continue never re-decides what to substitute.
   */
  readonly rewrittenSourceRef: string;
  readonly valueKind: string;
  readonly valueDigest: string;
  readonly sourceFormat: "dts" | "unsupported";
  readonly coupledBindingIds: readonly string[];
};

export type ReplacementPreviewImpact = {
  readonly selectedProjectCount: number;
  readonly compatibleProjectCount: number;
  readonly blockedProjectCount: number;
  readonly coupledDefinitionCount: number;
  readonly sourceFormatSupported: boolean;
  readonly oldDefinitionLifecycle: "active" | "deprecated" | "retired";
  readonly oldDefinitionCurrentReferenceCount: number;
  readonly targetRegistrationRequired: boolean;
};

export type ReplacementProjectView = {
  readonly projectId: string;
  readonly projectName: string;
  readonly status: ReplacementProjectStatus;
  readonly blockerReason: string | null;
  readonly oldBindingId: string;
  readonly oldValueId: string;
  readonly newBindingId: string | null;
  readonly newValueId: string | null;
  readonly valueKind: string;
  readonly compatible: boolean;
  readonly attemptCount: number;
  readonly registrationRequired: boolean;
};

export type ReplacementIdentityView = {
  readonly definitionId: string;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly propertyKey: string;
  readonly revisionId: string;
};

export type DefinitionReplacementView = {
  readonly id: string;
  readonly status: ReplacementStatus;
  readonly organizationId: string;
  readonly oldIdentity: ReplacementIdentityView;
  readonly newIdentity: ReplacementIdentityView;
  readonly previewFingerprint: string;
  readonly catalogReleaseId: string;
  readonly candidateId: string | null;
  readonly publicationJobId: string | null;
  readonly authorizationId: string | null;
  readonly reason: string;
  readonly version: number;
  readonly projects: readonly ReplacementProjectView[];
  readonly createdAt: string;
};

export type DefinitionReplacementPreviewView = {
  readonly previewId: string;
  readonly previewFingerprint: string;
  readonly organizationId: string;
  readonly oldIdentity: ReplacementIdentityView;
  readonly newIdentity: ReplacementIdentityView;
  readonly catalogReleaseId: string;
  readonly impact: ReplacementPreviewImpact;
  readonly blockers: readonly string[];
  readonly projects: readonly ReplacementProjectView[];
  readonly expiresAt: string | null;
};

export type DefinitionReplacementFailure =
  | { readonly kind: "not-found" }
  | { readonly kind: "permission-denied" }
  | { readonly kind: "invalid-command"; readonly reason: string }
  | { readonly kind: "release-drift"; readonly expected: CatalogReleasePin; readonly actual: CatalogReleasePin }
  | { readonly kind: "synchronization-busy" }
  | {
      readonly kind: "stale-preview";
      readonly expectedFingerprint: string;
      readonly actualFingerprint: string;
    }
  | {
      readonly kind: "preview-unavailable";
      readonly reason:
        | "artifact-missing"
        | "predecessor-incomplete"
        | "subject-not-found"
        | "subject-not-active"
        | "unsupported-catalog-capability"
        | "publication-policy-disabled"
        | "publication-frozen"
        | "needs-rebase"
        | "preview-expired"
        | "preview-consumed";
    }
  | {
      readonly kind: "target-identity-conflict";
      readonly reason:
        | "duplicate-natural-key"
        | "duplicate-canonical-key"
        | "duplicate-selector"
        | "duplicate-alias";
    }
  | { readonly kind: "registration-required"; readonly organizationId: string }
  | { readonly kind: "incompatible-value"; readonly bindingId: string; readonly detail: string }
  | { readonly kind: "pending-work-conflict"; readonly bindingId: string; readonly reason: string }
  | { readonly kind: "unsupported-source-format"; readonly bindingId: string }
  | { readonly kind: "missing-source-provenance"; readonly bindingId: string }
  | { readonly kind: "ambiguous-source-match"; readonly bindingId: string }
  | { readonly kind: "coupled-source-impact"; readonly bindingIds: readonly string[] }
  | {
      readonly kind: "revision-conflict";
      readonly idempotencyKey: string;
      readonly storedFingerprint: string;
      readonly attemptedFingerprint: string;
    }
  | { readonly kind: "one-current-successor"; readonly oldDefinitionId: string }
  | { readonly kind: "replacement-chain"; readonly newDefinitionId: string }
  | { readonly kind: "publication-unavailable"; readonly jobId: string | null };

/** Publication evidence a create must reference (frozen §3.1). */
export type ReplacementPublicationReference = {
  readonly candidateId: string;
  readonly publicationJobId: string;
  readonly authorizationId: string;
  readonly replayed: boolean;
};

export type ReplacementPublicationState =
  | { readonly kind: "active"; readonly releaseId: string; readonly releaseDigest: string }
  | { readonly kind: "pending"; readonly jobId: string }
  | { readonly kind: "blocked"; readonly jobId: string; readonly reason: string };

export type ReplacementPublicationPorts = {
  /**
   * Mint the publication job through the existing Candidate/Authorization
   * enqueue path.  Runs in its own coordinator transaction; never inside a
   * caller transaction.
   */
  readonly enqueueReplacementPublication: (input: {
    readonly organizationId: string;
    readonly candidateId: string;
    readonly idempotencyKey: string;
    readonly trustedActor: import("../auth/trustedInvocation").TrustedInvocationContext;
  }) => Promise<
    { readonly ok: true; readonly value: ReplacementPublicationReference } | { readonly ok: false; readonly error: DefinitionReplacementFailure }
  >;
  /**
   * Drive an already-queued publication job to a terminal state.  In production
   * this belongs to the publication-manager process; the API process must not
   * install Catalog (CP-07 isolation, ADR-0043 §5).
   */
  readonly activateReplacementPublication?: (input: {
    readonly jobId: string;
  }) => Promise<ReplacementPublicationState>;
};

export type DefinitionReplacementServiceInput = {
  readonly db: import("../../shared/database/client").Database;
  readonly publication?: ReplacementPublicationPorts;
  readonly now?: () => Date;
};

export const mintReplacementId = (): string => `drep_${randomUUID().replace(/-/g, "")}`;
export const mintReplacementProjectId = (): string => `drepp_${randomUUID().replace(/-/g, "")}`;
export const mintReplacementPreviewId = (): string => `drpv_${randomUUID().replace(/-/g, "")}`;
export const mintReplacementValueId = (): string => `pval_${randomUUID().replace(/-/g, "")}`;
export const mintReplacementBindingId = (): string => `pbind_${randomUUID().replace(/-/g, "")}`;
export const mintReplacementHistoryEventId = (): string => `bhev_${randomUUID().replace(/-/g, "")}`;

const CONTROL_FREE = /^[^\u0000-\u001F\u007F-\u009F]+$/u;

export const isControlFree = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value && CONTROL_FREE.test(value);

export const toContractJson = (value: unknown): ContractJsonValue =>
  value as ContractJsonValue;
