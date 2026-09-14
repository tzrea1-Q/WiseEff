import type {
  CatalogContinueReplacementRequest,
  CatalogCreateReplacementRequest,
  CatalogCreatePublicationCandidateRequest,
  CatalogDefinitionListResponse,
  CatalogDefinitionResponse,
  CatalogDefinitionRevisionListResponse,
  CatalogDefinitionRevisionResponse,
  CatalogDefinitionTimelineResponse,
  CatalogDocumentResponse,
  CatalogLegacyIdentifierResponse,
  CatalogListQuery,
  CatalogPublicationCandidateResponse,
  CatalogPublicationJobResponse,
  CatalogPublishPublicationCandidateRequest,
  CatalogSubjectListResponse,
  CatalogSubjectResponse,
  CatalogPublicationJobListResponse,
  CatalogPublicationSurfaceResponse,
  CatalogReplacementListResponse,
  CatalogReplacementPreviewRequest,
  CatalogReplacementPreviewResponse,
  CatalogReplacementResponse
} from "@/infrastructure/http/parameterCatalogDtos";

export type {
  CatalogContinueReplacementRequest,
  CatalogCreateReplacementRequest,
  CatalogReplacementListResponse,
  CatalogReplacementPreviewRequest,
  CatalogReplacementPreviewResponse,
  CatalogReplacementResponse,
  CatalogCreatePublicationCandidateRequest,
  CatalogDefinitionListResponse,
  CatalogDefinitionResponse,
  CatalogDefinitionRevisionListResponse,
  CatalogDefinitionRevisionResponse,
  CatalogDefinitionTimelineResponse,
  CatalogDocumentResponse,
  CatalogLegacyIdentifierResponse,
  CatalogListQuery,
  CatalogPublicationCandidateResponse,
  CatalogPublicationJobListResponse,
  CatalogPublicationJobResponse,
  CatalogPublicationSurfaceResponse,
  CatalogPublishPublicationCandidateRequest,
  CatalogSubjectListResponse,
  CatalogSubjectResponse
};

/** Release pin for the four frozen publication routes. Idempotency for publish lives in the body. */
export type CatalogPublicationWriteContext = {
  catalogReleaseId: string;
};

/** CatalogRead + DefinitionTimeline + LegacyLink + frozen publication commands. */
export interface ParameterCatalogRepository {
  getCatalog(query?: CatalogListQuery): Promise<CatalogDocumentResponse>;
  listSubjects(query?: CatalogListQuery): Promise<CatalogSubjectListResponse>;
  getSubject(subjectId: string, query?: CatalogListQuery): Promise<CatalogSubjectResponse>;
  listSubjectDefinitions(
    subjectId: string,
    query?: CatalogListQuery
  ): Promise<CatalogDefinitionListResponse>;
  listDefinitions(query?: CatalogListQuery): Promise<CatalogDefinitionListResponse>;
  getDefinition(definitionId: string, query?: CatalogListQuery): Promise<CatalogDefinitionResponse>;
  listDefinitionRevisions(
    definitionId: string,
    query?: CatalogListQuery
  ): Promise<CatalogDefinitionRevisionListResponse>;
  getDefinitionRevision(
    definitionId: string,
    revisionId: string,
    query?: CatalogListQuery
  ): Promise<CatalogDefinitionRevisionResponse>;
  listDefinitionTimeline(
    definitionId: string,
    query?: CatalogListQuery
  ): Promise<CatalogDefinitionTimelineResponse>;
  getLegacyIdentifier(legacyType: string, legacyId: string): Promise<CatalogLegacyIdentifierResponse>;
  createPublicationCandidate(
    body: CatalogCreatePublicationCandidateRequest,
    context: CatalogPublicationWriteContext
  ): Promise<CatalogPublicationCandidateResponse>;
  getPublicationCandidate(candidateId: string): Promise<CatalogPublicationCandidateResponse>;
  publishPublicationCandidate(
    candidateId: string,
    body: CatalogPublishPublicationCandidateRequest,
    context: CatalogPublicationWriteContext
  ): Promise<CatalogPublicationJobResponse>;
  getPublication(jobId: string): Promise<CatalogPublicationJobResponse>;
  getPublicationSurface(): Promise<CatalogPublicationSurfaceResponse>;
  listPublications(query?: CatalogListQuery): Promise<CatalogPublicationJobListResponse>;
  previewDefinitionReplacement(
    body: CatalogReplacementPreviewRequest,
    context: CatalogPublicationWriteContext
  ): Promise<CatalogReplacementPreviewResponse>;
  listDefinitionReplacements(query?: CatalogListQuery): Promise<CatalogReplacementListResponse>;
  createDefinitionReplacement(
    body: CatalogCreateReplacementRequest,
    context: { catalogReleaseId: string }
  ): Promise<CatalogReplacementResponse>;
  getDefinitionReplacement(replacementId: string): Promise<CatalogReplacementResponse>;
  continueDefinitionReplacement(
    replacementId: string,
    body: CatalogContinueReplacementRequest,
    context: { catalogReleaseId: string }
  ): Promise<CatalogReplacementResponse>;
}
