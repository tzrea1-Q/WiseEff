import type {
  CatalogAcceptProposalRequest,
  CatalogCreateProposalRequest,
  CatalogListQuery,
  CatalogObservationListResponse,
  CatalogObservationResponse,
  CatalogPlacementResponse,
  CatalogProposalListResponse,
  CatalogProposalResponse,
  CatalogRegisterSubjectRequest,
  CatalogRegistrationListResponse,
  CatalogRegistrationResponse,
  CatalogRejectProposalRequest,
  CatalogResolveReviewItemRequest,
  CatalogRestoreRegistrationRequest,
  CatalogRetireRegistrationRequest,
  CatalogReviewItemListResponse,
  CatalogReviewItemResponse,
  CatalogReviewResolutionResponse,
  CatalogSubmitProposalRequest,
  CatalogUpdatePlacementRequest,
  CatalogWithdrawProposalRequest
} from "@/infrastructure/http/parameterCatalogDtos";

export type {
  CatalogAcceptProposalRequest,
  CatalogCreateProposalRequest,
  CatalogListQuery,
  CatalogObservationListResponse,
  CatalogObservationResponse,
  CatalogPlacementResponse,
  CatalogProposalListResponse,
  CatalogProposalResponse,
  CatalogRegisterSubjectRequest,
  CatalogRegistrationListResponse,
  CatalogRegistrationResponse,
  CatalogRejectProposalRequest,
  CatalogResolveReviewItemRequest,
  CatalogRestoreRegistrationRequest,
  CatalogRetireRegistrationRequest,
  CatalogReviewItemListResponse,
  CatalogReviewItemResponse,
  CatalogReviewResolutionResponse,
  CatalogSubmitProposalRequest,
  CatalogUpdatePlacementRequest,
  CatalogWithdrawProposalRequest
};

/** Release + idempotency for new Governance/Proposal commands. */
export type CatalogIdempotentWriteContext = {
  catalogReleaseId: string;
  idempotencyKey: string;
};

/** Existing mutable Governance/Proposal resources also require If-Match. */
export type CatalogConditionalWriteContext = CatalogIdempotentWriteContext & {
  ifMatch: string;
};

/** SubjectGovernance + ReviewQueue + DefinitionProposal. Closed canonical governance seam. */
export interface ParameterCatalogGovernanceRepository {
  listRegistrations(
    organizationId: string,
    query?: CatalogListQuery
  ): Promise<CatalogRegistrationListResponse>;
  createRegistration(
    organizationId: string,
    body: CatalogRegisterSubjectRequest,
    context: CatalogIdempotentWriteContext
  ): Promise<CatalogRegistrationResponse>;
  getRegistration(
    organizationId: string,
    registrationId: string
  ): Promise<CatalogRegistrationResponse>;
  retireRegistration(
    organizationId: string,
    registrationId: string,
    body: CatalogRetireRegistrationRequest,
    context: CatalogConditionalWriteContext
  ): Promise<CatalogRegistrationResponse>;
  restoreRegistration(
    organizationId: string,
    registrationId: string,
    body: CatalogRestoreRegistrationRequest,
    context: CatalogConditionalWriteContext
  ): Promise<CatalogRegistrationResponse>;
  getPlacement(organizationId: string, registrationId: string): Promise<CatalogPlacementResponse>;
  updatePlacement(
    organizationId: string,
    registrationId: string,
    body: CatalogUpdatePlacementRequest,
    context: CatalogConditionalWriteContext
  ): Promise<CatalogPlacementResponse>;
  listObservations(
    organizationId: string,
    query?: CatalogListQuery
  ): Promise<CatalogObservationListResponse>;
  getObservation(
    organizationId: string,
    observationId: string
  ): Promise<CatalogObservationResponse>;
  listReviewItems(
    organizationId: string,
    query?: CatalogListQuery
  ): Promise<CatalogReviewItemListResponse>;
  getReviewItem(organizationId: string, reviewItemId: string): Promise<CatalogReviewItemResponse>;
  resolveReviewItem(
    organizationId: string,
    reviewItemId: string,
    body: CatalogResolveReviewItemRequest,
    context: CatalogConditionalWriteContext
  ): Promise<CatalogReviewResolutionResponse>;
  listProposals(query?: CatalogListQuery): Promise<CatalogProposalListResponse>;
  createProposal(
    body: CatalogCreateProposalRequest,
    context: CatalogIdempotentWriteContext
  ): Promise<CatalogProposalResponse>;
  getProposal(proposalId: string): Promise<CatalogProposalResponse>;
  submitProposal(
    proposalId: string,
    body: CatalogSubmitProposalRequest,
    context: CatalogConditionalWriteContext
  ): Promise<CatalogProposalResponse>;
  withdrawProposal(
    proposalId: string,
    body: CatalogWithdrawProposalRequest,
    context: CatalogConditionalWriteContext
  ): Promise<CatalogProposalResponse>;
  acceptProposal(
    proposalId: string,
    body: CatalogAcceptProposalRequest,
    context: CatalogConditionalWriteContext
  ): Promise<CatalogProposalResponse>;
  rejectProposal(
    proposalId: string,
    body: CatalogRejectProposalRequest,
    context: CatalogConditionalWriteContext
  ): Promise<CatalogProposalResponse>;
}
