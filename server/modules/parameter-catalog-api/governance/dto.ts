import {
  catalogObservationDtoSchema,
  catalogPlacementDtoSchema,
  catalogProposalDtoSchema,
  catalogRegistrationDtoSchema,
  catalogReviewItemDtoSchema,
  catalogReviewResolutionDtoSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import type { RegistrationResult } from "../../parameter-governance/registration/result";
import type { ReviewQueueItem } from "../../parameter-governance/review/types";
import type { ReviewResolutionResult } from "../../parameter-governance/resolveReviewItem/result";
import type { ProposalResult } from "../../parameter-governance/proposals/result";
import type { ObservationRecord, ProposalRecord, RegistrationRecord } from "./types";
import { quoteEtag } from "./query";

export function mapRegistrationRecord(
  record: RegistrationRecord,
): ReturnType<typeof catalogRegistrationDtoSchema.parse> {
  return catalogRegistrationDtoSchema.parse({
    id: record.id,
    organizationId: record.organizationId,
    subjectId: record.subjectId,
    status: record.status,
    method: record.method,
    placement: record.placement,
    catalogReleaseId: record.catalogReleaseId,
  });
}

export function mapRegistrationResult(
  result: RegistrationResult,
  placement: RegistrationRecord["placement"],
): ReturnType<typeof catalogRegistrationDtoSchema.parse> {
  return catalogRegistrationDtoSchema.parse({
    id: result.registrationId,
    organizationId: result.organizationId,
    subjectId: result.subjectId,
    status: result.registrationStatus,
    method: result.registrationMethod,
    placement,
    catalogReleaseId: result.release.id,
  });
}

export function mapPlacement(
  placement: RegistrationRecord["placement"],
): ReturnType<typeof catalogPlacementDtoSchema.parse> {
  return catalogPlacementDtoSchema.parse(placement);
}

export function mapObservation(
  record: ObservationRecord,
): ReturnType<typeof catalogObservationDtoSchema.parse> {
  return catalogObservationDtoSchema.parse(record);
}

export function mapReviewItem(
  item: ReviewQueueItem,
): ReturnType<typeof catalogReviewItemDtoSchema.parse> {
  const firstEvidence = item.evidenceRefs[0];
  return catalogReviewItemDtoSchema.parse({
    id: item.id,
    organizationId: item.organizationId,
    reason: item.reason,
    status: item.status,
    etag: item.etag,
    catalogReleaseId: item.catalogReleaseId,
    ...(firstEvidence
      ? {
          observation: {
            id: firstEvidence.id,
            propertyKey: item.identityKey,
            sourceRef: { kind: "review-evidence", id: firstEvidence.id },
          },
        }
      : {}),
    candidates: item.evidenceRefs.map((ref) => ({
      subjectId: item.identityKey,
      evidence: [ref.candidateSafeDigest],
    })),
    allowedResolutions: [...item.allowedResolutions],
    candidateState: item.candidateState,
  });
}

export function mapReviewResolution(
  result: ReviewResolutionResult,
  placement?: RegistrationRecord["placement"],
): ReturnType<typeof catalogReviewResolutionDtoSchema.parse> {
  return catalogReviewResolutionDtoSchema.parse({
    reviewItem: {
      id: result.reviewItemId,
      status: result.status,
    },
    ...(result.registrationId && result.subjectId
      ? {
          registration: {
            id: result.registrationId,
            subjectId: result.subjectId,
            placement: placement ?? {
              id: result.placementId ?? result.registrationId,
              displayName: result.placementId ?? result.registrationId,
              parentPlacementId: null,
            },
          },
        }
      : {}),
    ...(result.proposalId ? { proposalId: result.proposalId } : {}),
    catalogReleaseId: result.release.id,
  });
}

export function mapProposalRecord(
  record: ProposalRecord,
): ReturnType<typeof catalogProposalDtoSchema.parse> {
  return catalogProposalDtoSchema.parse({
    id: record.id,
    organizationId: record.organizationId,
    status: record.status,
    etag: record.etag,
    base: record.base,
    requestedChange: record.requestedChange,
    submittedByPersonId: record.submittedByPersonId,
    acceptedByPersonId: record.acceptedByPersonId,
    publicationIntentRef: record.publicationIntentRef,
    version: record.version,
  });
}

export function mapProposalResult(
  result: ProposalResult,
  submittedByPersonId: string | null,
): ReturnType<typeof catalogProposalDtoSchema.parse> {
  return catalogProposalDtoSchema.parse({
    id: result.proposalId,
    organizationId: result.organizationId,
    status: result.status,
    etag: quoteEtag(`${result.proposalId}-v${result.etagVersion}`),
    base: {
      catalogReleaseId: result.baseCatalogReleaseId,
      definitionId: null,
      definitionRevisionId: result.baseDefinitionRevisionId,
    },
    requestedChange: { kind: "definition-proposal" },
    submittedByPersonId,
    acceptedByPersonId: result.publicationIntent?.reviewerPrincipalId ?? null,
    publicationIntentRef: result.publicationIntent?.id ?? null,
    version: result.etagVersion,
  });
}

export function registrationEtag(result: RegistrationResult | RegistrationRecord): string {
  if ("etag" in result) {
    return quoteEtag(result.etag);
  }
  return quoteEtag(`${result.registrationId}:${result.registrationStatus}`);
}

export function placementEtag(placementId: string): string {
  return quoteEtag(placementId);
}

export function reviewEtag(etag: string): string {
  return quoteEtag(etag);
}

export function proposalEtag(proposalId: string, version: number): string {
  return quoteEtag(`${proposalId}-v${version}`);
}

export function listEnvelope<T>(
  items: readonly T[],
  catalogReleaseId: string,
  emptyReason?: "no-registrations" | "no-review-work" | "no-filter-match",
): {
  items: T[];
  nextCursor: null;
  catalogReleaseId: string;
  emptyReason?: "no-registrations" | "no-review-work" | "no-filter-match";
} {
  return {
    items: [...items],
    nextCursor: null,
    catalogReleaseId,
    ...(items.length === 0 && emptyReason ? { emptyReason } : {}),
  };
}
