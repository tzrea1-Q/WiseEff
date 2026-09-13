import type {
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
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";

export type {
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
}
