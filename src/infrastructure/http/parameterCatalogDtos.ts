import type { z } from "zod";

import type {
  bindingDraftResponseSchema,
  catalogBindingChangeHistoryListResponseSchema,
  bindingCompareListResponseSchema,
  bindingHistoryListResponseSchema,
  catalogAcceptProposalRequestSchema,
  catalogCreateProposalRequestSchema,
  catalogCreatePublicationCandidateRequestSchema,
  catalogBindingExportResponseSchema,
  catalogBindingDraftDtoSchema,
  catalogValueChangeRequestDtoSchema,
  catalogValueChangeRequestListResponseSchema,
  catalogValueChangeRequestResponseSchema,
  catalogMemberRemovalRequestResponseSchema,
  catalogMemberRemovalRequestListResponseSchema,
  catalogSubmitMemberRemovalRequestSchema,
  catalogReviewMemberRemovalRequestSchema,
  catalogValueChangeSourceDiffResponseSchema,
  catalogCreateReplacementRequestSchema,
  catalogContinueReplacementRequestSchema,
  catalogReplacementDtoSchema,
  catalogReplacementListResponseSchema,
  catalogReplacementPreviewDtoSchema,
  catalogReplacementPreviewRequestSchema,
  catalogReplacementPreviewResponseSchema,
  catalogReplacementProjectDtoSchema,
  catalogReplacementResponseSchema,
  catalogPublishPublicationCandidateRequestSchema,
  catalogPublicationCandidateResponseSchema,
  catalogPublicationJobListResponseSchema,
  catalogPublicationJobResponseSchema,
  catalogPublicationSurfaceResponseSchema,
  catalogCreateBindingDraftRequestSchema,
  catalogCreateNodeEnablementDraftRequestSchema,
  catalogDefinitionListResponseSchema,
  catalogDefinitionResponseSchema,
  catalogDefinitionRevisionListResponseSchema,
  catalogDefinitionRevisionResponseSchema,
  catalogDefinitionTimelineResponseSchema,
  catalogDocumentResponseSchema,
  catalogLegacyGoneResponseSchema,
  catalogLegacyIdentifierResponseSchema,
  catalogObservationListResponseSchema,
  catalogObservationResponseSchema,
  catalogPlacementResponseSchema,
  catalogProjectBindingDtoSchema,
  catalogProposalListResponseSchema,
  catalogProposalResponseSchema,
  catalogRegisterSubjectRequestSchema,
  catalogRegistrationListResponseSchema,
  catalogRegistrationResponseSchema,
  catalogRejectProposalRequestSchema,
  catalogResolveReviewItemRequestSchema,
  catalogRestoreRegistrationRequestSchema,
  catalogRetireRegistrationRequestSchema,
  catalogReviewItemListResponseSchema,
  catalogReviewItemResponseSchema,
  catalogReviewResolutionResponseSchema,
  catalogSubjectListResponseSchema,
  catalogSubjectResponseSchema,
  catalogSubmitProposalRequestSchema,
  catalogUpdatePlacementRequestSchema,
  catalogWithdrawProposalRequestSchema,
  nodeEnablementDraftResponseSchema,
  projectParameterBindingListResponseSchema,
  projectValueDraftListResponseSchema,
  projectValueDraftRemovedResponseSchema
} from "@wiseeff/dto-schemas";

export type CatalogReplacement = z.infer<typeof catalogReplacementDtoSchema>;
export type CatalogReplacementProject = z.infer<typeof catalogReplacementProjectDtoSchema>;
export type CatalogReplacementPreview = z.infer<typeof catalogReplacementPreviewDtoSchema>;
export type CatalogReplacementResponse = z.infer<typeof catalogReplacementResponseSchema>;
export type CatalogReplacementPreviewResponse = z.infer<typeof catalogReplacementPreviewResponseSchema>;
export type CatalogReplacementListResponse = z.infer<typeof catalogReplacementListResponseSchema>;
export type CatalogReplacementPreviewRequest = z.infer<typeof catalogReplacementPreviewRequestSchema>;
export type CatalogCreateReplacementRequest = z.infer<
  typeof catalogCreateReplacementRequestSchema
>;
export type CatalogContinueReplacementRequest = z.infer<
  typeof catalogContinueReplacementRequestSchema
>;
export type CatalogDocumentResponse = z.infer<typeof catalogDocumentResponseSchema>;
export type CatalogSubjectListResponse = z.infer<typeof catalogSubjectListResponseSchema>;
export type CatalogSubjectResponse = z.infer<typeof catalogSubjectResponseSchema>;
export type CatalogDefinitionListResponse = z.infer<typeof catalogDefinitionListResponseSchema>;
export type CatalogDefinitionResponse = z.infer<typeof catalogDefinitionResponseSchema>;
export type CatalogDefinitionRevisionListResponse = z.infer<
  typeof catalogDefinitionRevisionListResponseSchema
>;
export type CatalogDefinitionRevisionResponse = z.infer<typeof catalogDefinitionRevisionResponseSchema>;
export type CatalogDefinitionTimelineResponse = z.infer<typeof catalogDefinitionTimelineResponseSchema>;
export type CatalogRegistrationListResponse = z.infer<typeof catalogRegistrationListResponseSchema>;
export type CatalogRegistrationResponse = z.infer<typeof catalogRegistrationResponseSchema>;
export type CatalogRegisterSubjectRequest = z.infer<typeof catalogRegisterSubjectRequestSchema>;
export type CatalogRetireRegistrationRequest = z.infer<typeof catalogRetireRegistrationRequestSchema>;
export type CatalogRestoreRegistrationRequest = z.infer<typeof catalogRestoreRegistrationRequestSchema>;
export type CatalogPlacementResponse = z.infer<typeof catalogPlacementResponseSchema>;
export type CatalogUpdatePlacementRequest = z.infer<typeof catalogUpdatePlacementRequestSchema>;
export type CatalogObservationListResponse = z.infer<typeof catalogObservationListResponseSchema>;
export type CatalogObservationResponse = z.infer<typeof catalogObservationResponseSchema>;
export type CatalogReviewItemListResponse = z.infer<typeof catalogReviewItemListResponseSchema>;
export type CatalogReviewItemResponse = z.infer<typeof catalogReviewItemResponseSchema>;
export type CatalogResolveReviewItemRequest = z.infer<typeof catalogResolveReviewItemRequestSchema>;
export type CatalogReviewResolutionResponse = z.infer<typeof catalogReviewResolutionResponseSchema>;
export type CatalogProposalListResponse = z.infer<typeof catalogProposalListResponseSchema>;
export type CatalogProposalResponse = z.infer<typeof catalogProposalResponseSchema>;
export type CatalogCreateProposalRequest = z.infer<typeof catalogCreateProposalRequestSchema>;
export type CatalogCreatePublicationCandidateRequest = z.infer<
  typeof catalogCreatePublicationCandidateRequestSchema
>;
export type CatalogPublishPublicationCandidateRequest = z.infer<
  typeof catalogPublishPublicationCandidateRequestSchema
>;
export type CatalogPublicationCandidateResponse = z.infer<
  typeof catalogPublicationCandidateResponseSchema
>;
export type CatalogPublicationJobResponse = z.infer<typeof catalogPublicationJobResponseSchema>;
export type CatalogPublicationJobListResponse = z.infer<typeof catalogPublicationJobListResponseSchema>;
export type CatalogPublicationSurfaceResponse = z.infer<typeof catalogPublicationSurfaceResponseSchema>;
export type CatalogSubmitProposalRequest = z.infer<typeof catalogSubmitProposalRequestSchema>;
export type CatalogWithdrawProposalRequest = z.infer<typeof catalogWithdrawProposalRequestSchema>;
export type CatalogAcceptProposalRequest = z.infer<typeof catalogAcceptProposalRequestSchema>;
export type CatalogRejectProposalRequest = z.infer<typeof catalogRejectProposalRequestSchema>;
export type CatalogLegacyIdentifierResponse = z.infer<typeof catalogLegacyIdentifierResponseSchema>;
export type CatalogLegacyGoneResponse = z.infer<typeof catalogLegacyGoneResponseSchema>;
export type CatalogProjectBindingDto = z.infer<typeof catalogProjectBindingDtoSchema>;
export type CatalogProjectBindingListResponse = z.infer<typeof projectParameterBindingListResponseSchema>;
export type CatalogBindingHistoryListResponse = z.infer<typeof bindingHistoryListResponseSchema>;
export type CatalogBindingChangeHistoryListResponse = z.infer<
  typeof catalogBindingChangeHistoryListResponseSchema
>;
export type CatalogBindingCompareListResponse = z.infer<typeof bindingCompareListResponseSchema>;
export type CatalogBindingExportResponse = z.infer<typeof catalogBindingExportResponseSchema>;
export type CatalogCreateBindingDraftRequest = z.infer<typeof catalogCreateBindingDraftRequestSchema>;
export type CatalogBindingDraftResponse = z.infer<typeof bindingDraftResponseSchema>;
export type CatalogBindingDraftDto = z.infer<typeof catalogBindingDraftDtoSchema>;
export type CatalogProjectValueDraftListResponse = z.infer<typeof projectValueDraftListResponseSchema>;
export type CatalogProjectValueDraftRemovedResponse = z.infer<typeof projectValueDraftRemovedResponseSchema>;
export type CatalogValueChangeRequestDto = z.infer<typeof catalogValueChangeRequestDtoSchema>;
export type CatalogValueChangeRequestListResponse = z.infer<typeof catalogValueChangeRequestListResponseSchema>;
export type CatalogValueChangeRequestResponse = z.infer<typeof catalogValueChangeRequestResponseSchema>;
export type CatalogMemberRemovalRequestResponse = z.infer<typeof catalogMemberRemovalRequestResponseSchema>;
export type CatalogMemberRemovalRequestListResponse = z.infer<typeof catalogMemberRemovalRequestListResponseSchema>;
export type CatalogSubmitMemberRemovalRequest = z.infer<typeof catalogSubmitMemberRemovalRequestSchema>;
export type CatalogReviewMemberRemovalRequest = z.infer<typeof catalogReviewMemberRemovalRequestSchema>;
export type CatalogValueChangeSourceDiffResponse = z.infer<
  typeof catalogValueChangeSourceDiffResponseSchema
>;
export type CatalogCreateNodeEnablementDraftRequest = z.infer<
  typeof catalogCreateNodeEnablementDraftRequestSchema
>;
export type CatalogNodeEnablementDraftResponse = z.infer<typeof nodeEnablementDraftResponseSchema>;

export type CatalogListQuery = {
  cursor?: string;
  limit?: number;
  type?: "driver" | "node-type";
  lifecycle?: string;
  registration?: string;
  search?: string;
  subjectId?: string;
  /** Explicit trusted multi-subject scope, applied before pagination. */
  subjectIds?: readonly string[];
  /** Organization module subtree filter, resolved server-side before pagination. */
  placementModuleId?: string;
  propertyKey?: string;
  catalogReleaseId?: string;
};

export function catalogDocumentFromDto(dto: CatalogDocumentResponse): CatalogDocumentResponse {
  return dto;
}

export function catalogSubjectFromDto(dto: CatalogSubjectResponse): CatalogSubjectResponse {
  return dto;
}

export function catalogDefinitionFromDto(dto: CatalogDefinitionResponse): CatalogDefinitionResponse {
  return dto;
}

export function catalogProjectBindingFromDto(dto: CatalogProjectBindingDto): CatalogProjectBindingDto {
  return dto;
}
