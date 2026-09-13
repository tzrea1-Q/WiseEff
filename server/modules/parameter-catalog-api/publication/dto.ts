import {
  catalogPublicationCandidateDtoSchema,
  catalogPublicationJobDtoSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import type { PublicationCandidateView, PublicationJobView } from "./types";

export function mapPublicationCandidate(
  view: PublicationCandidateView,
): ReturnType<typeof catalogPublicationCandidateDtoSchema.parse> {
  return catalogPublicationCandidateDtoSchema.parse({
    id: view.id,
    expectedBaseReleaseId: view.expectedBaseReleaseId,
    expectedBaseReleaseDigest: view.expectedBaseReleaseDigest,
    riskClass: view.riskClass,
    impactSummary: view.impactSummary,
    capabilityContract: view.capabilityContract,
  });
}

export function mapPublicationJob(
  view: PublicationJobView,
): ReturnType<typeof catalogPublicationJobDtoSchema.parse> {
  return catalogPublicationJobDtoSchema.parse({
    id: view.id,
    candidateId: view.candidateId,
    status: view.status,
    attemptCount: view.attemptCount,
    effective: view.effective,
    isCurrent: view.isCurrent,
    currentness: view.currentness,
    failure: view.failure,
  });
}

export function itemEnvelope<T>(item: T): { item: T } {
  return { item };
}
