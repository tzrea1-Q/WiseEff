import type {
  CatalogContinueReplacementRequest,
  CatalogBindingExportResponse,
  CatalogBindingChangeHistoryListResponse,
  CatalogProjectValueDraftListResponse,
  CatalogProjectValueDraftRemovedResponse,
  CatalogValueChangeRequestListResponse,
  CatalogValueChangeRequestResponse,
  CatalogValueChangeSourceDiffResponse,
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

/**
 * Identity correction commands are catalog write routes: every one carries an
 * idempotency key, and `create`/`continue` are additionally fenced with
 * `If-Match` (the frozen preview fingerprint, then the replacement ETag).
 */
export type CatalogReplacementWriteContext = CatalogPublicationWriteContext & {
  idempotencyKey: string;
  ifMatch?: string;
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
    context: CatalogReplacementWriteContext
  ): Promise<CatalogReplacementPreviewResponse>;
  listDefinitionReplacements(query?: CatalogListQuery): Promise<CatalogReplacementListResponse>;
  createDefinitionReplacement(
    body: CatalogCreateReplacementRequest,
    context: CatalogReplacementWriteContext
  ): Promise<CatalogReplacementResponse>;
  getDefinitionReplacement(replacementId: string): Promise<CatalogReplacementResponse>;
  continueDefinitionReplacement(
    replacementId: string,
    body: CatalogContinueReplacementRequest,
    context: CatalogReplacementWriteContext
  ): Promise<CatalogReplacementResponse>;

  /** Canonical project-value workflow. Optional for the governance-only mock adapter. */
  listProjectValueDrafts?(projectId: string): Promise<CatalogProjectValueDraftListResponse>;
  deleteProjectValueDraft?(
    projectId: string,
    draftId: string,
    context?: Partial<CatalogReplacementWriteContext>
  ): Promise<CatalogProjectValueDraftRemovedResponse>;
  submitProjectValueDraft?(
    projectId: string,
    draftId: string,
    body: { assignedToUserId?: string | null },
    context: CatalogPublicationWriteContext & { idempotencyKey: string }
  ): Promise<CatalogValueChangeRequestResponse>;
  listProjectValueChangeRequests?(
    projectId: string,
    query?: { status?: string }
  ): Promise<CatalogValueChangeRequestListResponse>;
  reviewProjectValueChangeRequest?(
    projectId: string,
    requestId: string,
    body: { decision: "approve" | "reject"; note?: string | null },
    context: CatalogPublicationWriteContext & { idempotencyKey: string }
  ): Promise<CatalogValueChangeRequestResponse>;
  withdrawProjectValueChangeRequest?(
    projectId: string,
    requestId: string,
    context: CatalogPublicationWriteContext & { idempotencyKey: string }
  ): Promise<CatalogValueChangeRequestResponse>;
  getProjectValueChangeSourceDiff?(
    projectId: string,
    requestId: string
  ): Promise<CatalogValueChangeSourceDiffResponse>;
  getCanonicalBindingChangeHistory?(
    projectId: string,
    bindingId: string,
    limit?: number
  ): Promise<CatalogBindingChangeHistoryListResponse>;
  getCanonicalBindingExport?(
    projectId: string,
    bindingId: string,
    projectValueId?: string
  ): Promise<CatalogBindingExportResponse>;
}
