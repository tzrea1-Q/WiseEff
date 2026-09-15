import {
  catalogPublicationCandidateDtoSchema,
  catalogPublicationJobDtoSchema,
  catalogPublicationSurfaceDtoSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import type { PublicationCandidateView, PublicationJobView, PublicationSurfaceView } from "./types";

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

export function mapPublicationSurface(
  view: PublicationSurfaceView,
): ReturnType<typeof catalogPublicationSurfaceDtoSchema.parse> {
  return catalogPublicationSurfaceDtoSchema.parse(view);
}

export function itemEnvelope<T>(item: T): { item: T } {
  return { item };
}

export function itemsEnvelope<T>(
  items: readonly T[],
  catalogReleaseId: string,
): {
  items: T[];
  nextCursor: null;
  catalogReleaseId: string;
  totalCount: number;
  hasMore: boolean;
} {
  // The publication history list is not yet cursor-paged, so the honest total is
  // the returned item count and there is never a further page.
  return {
    items: [...items],
    nextCursor: null,
    catalogReleaseId,
    totalCount: items.length,
    hasMore: false,
  };
}
