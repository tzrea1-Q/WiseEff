import type {
  CatalogDefinitionListResponse,
  CatalogDefinitionResponse,
  CatalogDefinitionRevisionListResponse,
  CatalogDefinitionRevisionResponse,
  CatalogDefinitionTimelineResponse,
  CatalogDocumentResponse,
  CatalogLegacyIdentifierResponse,
  CatalogListQuery,
  CatalogSubjectListResponse,
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";

export type {
  CatalogDefinitionListResponse,
  CatalogDefinitionResponse,
  CatalogDefinitionRevisionListResponse,
  CatalogDefinitionRevisionResponse,
  CatalogDefinitionTimelineResponse,
  CatalogDocumentResponse,
  CatalogLegacyIdentifierResponse,
  CatalogListQuery,
  CatalogSubjectListResponse,
  CatalogSubjectResponse
};

/** CatalogRead + DefinitionTimeline + LegacyLink. Closed canonical catalog read seam. */
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
}
