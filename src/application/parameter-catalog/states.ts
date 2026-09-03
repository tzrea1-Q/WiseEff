import {
  catalogFailureClientBehaviors,
  type CatalogApiFailureReason,
  type CatalogFailureClientBehavior
} from "@wiseeff/dto-schemas";

import type {
  CatalogDefinitionResponse,
  CatalogDocumentResponse,
  CatalogReviewItemResponse,
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { catalogFailureReason } from "@/infrastructure/http/parameterCatalogClient";

export const catalogDomainStateKinds = [
  "ready",
  "unregistered",
  "empty",
  "loading",
  "error",
  "retired",
  "conflict"
] as const;

export type CatalogDomainStateKind = (typeof catalogDomainStateKinds)[number];

export const catalogEmptyReasons = [
  "no-registrations",
  "no-definitions",
  "no-review-work",
  "no-filter-match"
] as const;

export type CatalogEmptyReason = (typeof catalogEmptyReasons)[number];

export type CatalogRetiredTarget = "subject" | "definition" | "registration" | "legacy-surface";

export const catalogConflictReasons = [
  "release-drift",
  "placement-conflict",
  "invalid-placement-parent",
  "revision-conflict",
  "proposal-stale",
  "legacy-id-ambiguous",
  "observation-ambiguous"
] as const;

export type CatalogConflictReason = (typeof catalogConflictReasons)[number];

export type CatalogLoadingState = {
  readonly kind: "loading";
  readonly catalogReleaseId: string | null;
  readonly stale: boolean;
  readonly writesEnabled: false;
};

export type CatalogReadyState = {
  readonly kind: "ready";
  readonly catalogReleaseId: string;
  readonly writesEnabled: true;
};

export type CatalogUnregisteredState = {
  readonly kind: "unregistered";
  readonly catalogReleaseId: string;
  readonly subjectId: string | null;
  readonly writesEnabled: false;
};

export type CatalogEmptyState = {
  readonly kind: "empty";
  readonly catalogReleaseId: string;
  readonly emptyReason: CatalogEmptyReason;
  readonly writesEnabled: false;
};

export type CatalogErrorState = {
  readonly kind: "error";
  readonly catalogReleaseId: string | null;
  readonly reason: CatalogApiFailureReason | "unknown";
  readonly behavior: CatalogFailureClientBehavior | "unknown";
  readonly writesEnabled: false;
};

export type CatalogRetiredState = {
  readonly kind: "retired";
  readonly catalogReleaseId: string | null;
  readonly target: CatalogRetiredTarget;
  readonly writesEnabled: false;
};

export type CatalogConflictState = {
  readonly kind: "conflict";
  readonly catalogReleaseId: string | null;
  readonly reason: CatalogConflictReason;
  readonly behavior: CatalogFailureClientBehavior;
  readonly preserveInput: true;
  readonly silentRetry: false;
  readonly writesEnabled: false;
};

export type CatalogDomainState =
  | CatalogLoadingState
  | CatalogReadyState
  | CatalogUnregisteredState
  | CatalogEmptyState
  | CatalogErrorState
  | CatalogRetiredState
  | CatalogConflictState;

const CONFLICT_REASON_SET = new Set<string>(catalogConflictReasons);
const EMPTY_REASON_SET = new Set<string>(catalogEmptyReasons);

export type CatalogCollectionSnapshot = {
  items: readonly unknown[];
  catalogReleaseId: string;
  emptyReason?: string;
};

export type CatalogDomainStateInput = {
  inFlight?: boolean;
  previousReleaseId?: string | null;
  document?: CatalogDocumentResponse;
  subject?: CatalogSubjectResponse["item"];
  definition?: CatalogDefinitionResponse["item"];
  reviewItem?: CatalogReviewItemResponse["item"];
  collection?: CatalogCollectionSnapshot;
  error?: unknown;
};

function isEmptyReason(value: string | undefined): value is CatalogEmptyReason {
  return typeof value === "string" && EMPTY_REASON_SET.has(value);
}

function isConflictReason(value: string): value is CatalogConflictReason {
  return CONFLICT_REASON_SET.has(value);
}

function releaseFromError(error: unknown): string | null {
  if (!(error instanceof WiseEffApiError)) return null;
  const releaseId = error.details.catalogReleaseId;
  return typeof releaseId === "string" && releaseId.trim() ? releaseId : null;
}

export function catalogStateFromFailure(error: unknown): CatalogDomainState {
  if (!(error instanceof WiseEffApiError)) {
    return {
      kind: "error",
      catalogReleaseId: null,
      reason: "unknown",
      behavior: "unknown",
      writesEnabled: false
    };
  }

  const reason = catalogFailureReason(error);
  const catalogReleaseId = releaseFromError(error);

  if (reason === "registration-required") {
    const subjectId = error.details.subjectId;
    return {
      kind: "unregistered",
      catalogReleaseId: catalogReleaseId ?? "",
      subjectId: typeof subjectId === "string" ? subjectId : null,
      writesEnabled: false
    };
  }

  if (reason === "subject-retired") {
    return { kind: "retired", catalogReleaseId, target: "subject", writesEnabled: false };
  }
  if (reason === "definition-retired") {
    return { kind: "retired", catalogReleaseId, target: "definition", writesEnabled: false };
  }
  if (reason === "legacy-id-archived" || reason === "legacy-surface-retired") {
    return { kind: "retired", catalogReleaseId, target: "legacy-surface", writesEnabled: false };
  }

  if (reason !== "unknown" && isConflictReason(reason)) {
    return {
      kind: "conflict",
      catalogReleaseId,
      reason,
      behavior: catalogFailureClientBehaviors[reason],
      preserveInput: true,
      silentRetry: false,
      writesEnabled: false
    };
  }

  if (reason === "unknown") {
    return {
      kind: "error",
      catalogReleaseId,
      reason: "unknown",
      behavior: "unknown",
      writesEnabled: false
    };
  }

  return {
    kind: "error",
    catalogReleaseId,
    reason,
    behavior: catalogFailureClientBehaviors[reason],
    writesEnabled: false
  };
}

export function deriveCatalogDomainState(input: CatalogDomainStateInput): CatalogDomainState {
  if (input.inFlight) {
    const catalogReleaseId = input.previousReleaseId ?? input.document?.item.catalogReleaseId ?? null;
    return {
      kind: "loading",
      catalogReleaseId,
      stale: Boolean(catalogReleaseId),
      writesEnabled: false
    };
  }

  if (input.error !== undefined) {
    return catalogStateFromFailure(input.error);
  }

  if (input.reviewItem?.candidateState.status === "stale") {
    return {
      kind: "conflict",
      catalogReleaseId: input.reviewItem.catalogReleaseId,
      reason: "release-drift",
      behavior: catalogFailureClientBehaviors["release-drift"],
      preserveInput: true,
      silentRetry: false,
      writesEnabled: false
    };
  }

  const definition = input.definition;
  if (definition?.lifecycle === "retired" || definition?.lifecycle === "deprecated") {
    return {
      kind: "retired",
      catalogReleaseId: definition.currentRevision.publishedInCatalogReleaseId,
      target: "definition",
      writesEnabled: false
    };
  }

  const subject = input.subject;
  if (subject?.membership.status === "retired") {
    return {
      kind: "retired",
      catalogReleaseId: subject.membership.catalogReleaseId,
      target: "subject",
      writesEnabled: false
    };
  }
  if (subject?.registration.status === "retired") {
    return {
      kind: "retired",
      catalogReleaseId: subject.membership.catalogReleaseId,
      target: "registration",
      writesEnabled: false
    };
  }
  if (subject?.registration.status === "unregistered") {
    return {
      kind: "unregistered",
      catalogReleaseId: subject.membership.catalogReleaseId,
      subjectId: subject.id,
      writesEnabled: false
    };
  }

  const collection = input.collection;
  if (collection && collection.items.length === 0 && isEmptyReason(collection.emptyReason)) {
    return {
      kind: "empty",
      catalogReleaseId: collection.catalogReleaseId,
      emptyReason: collection.emptyReason,
      writesEnabled: false
    };
  }

  const document = input.document;
  if (document?.item.status === "ready") {
    return {
      kind: "ready",
      catalogReleaseId: document.item.catalogReleaseId,
      writesEnabled: true
    };
  }

  return {
    kind: "error",
    catalogReleaseId: document?.item.catalogReleaseId ?? collection?.catalogReleaseId ?? null,
    reason: "unknown",
    behavior: "unknown",
    writesEnabled: false
  };
}

export function catalogWritesEnabled(state: CatalogDomainState): boolean {
  return state.kind === "ready" && state.writesEnabled;
}
