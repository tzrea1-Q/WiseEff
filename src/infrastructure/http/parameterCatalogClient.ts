import type { ZodTypeAny, z } from "zod";

import {
  bindingDraftResponseSchema,
  bindingCompareListResponseSchema,
  bindingHistoryListResponseSchema,
  catalogBindingExportResponseSchema,
  catalogAcceptProposalRequestSchema,
  catalogCreateBindingDraftRequestSchema,
  catalogCreateNodeEnablementDraftRequestSchema,
  catalogCreateProposalRequestSchema,
  catalogCreatePublicationCandidateRequestSchema,
  catalogCreateReplacementRequestSchema,
  catalogContinueReplacementRequestSchema,
  catalogReplacementListResponseSchema,
  catalogReplacementPreviewRequestSchema,
  catalogReplacementPreviewResponseSchema,
  catalogReplacementResponseSchema,
  catalogPublishPublicationCandidateRequestSchema,
  catalogPublicationCandidateResponseSchema,
  catalogPublicationJobListResponseSchema,
  catalogPublicationJobResponseSchema,
  catalogPublicationSurfaceResponseSchema,
  catalogDefinitionListResponseSchema,
  catalogDefinitionResponseSchema,
  catalogDefinitionRevisionListResponseSchema,
  catalogDefinitionRevisionResponseSchema,
  catalogDefinitionTimelineResponseSchema,
  catalogDocumentResponseSchema,
  catalogFailureClientBehaviors,
  catalogForbiddenSpoofHeaders,
  catalogApiFailureReasonSchema,
  catalogLegacyGoneResponseSchema,
  catalogLegacyIdentifierResponseSchema,
  catalogLegacyIdentifierTypeSchema,
  catalogObservationListResponseSchema,
  catalogObservationResponseSchema,
  catalogPlacementResponseSchema,
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
  CATALOG_IDEMPOTENCY_HEADER,
  CATALOG_IF_MATCH_HEADER,
  CATALOG_RELEASE_HEADER,
  nodeEnablementDraftResponseSchema,
  parameterCatalogCanonicalRoutes,
  parameterCatalogClientMethodByRouteId,
  parameterCatalogLegacyWriteRouteIds,
  projectParameterBindingListResponseSchema,
  projectValueDraftListResponseSchema,
  projectValueDraftRemovedResponseSchema,
  catalogSubmitValueChangeRequestSchema,
  catalogReviewValueChangeRequestSchema,
  catalogBatchValueChangeRequestResponseSchema,
  catalogValueChangeReviewResponseSchema,
  catalogValueChangeRequestListResponseSchema,
  catalogValueChangeRequestResponseSchema,
  catalogValueChangeSourceDiffResponseSchema,
  catalogBindingChangeHistoryListResponseSchema,
  type CatalogApiFailureReason,
  type CatalogFailureClientBehavior,
  type ParameterCatalogCanonicalRouteId
} from "@wiseeff/dto-schemas";
import type {
  CatalogContinueReplacementRequest,
  CatalogCreateReplacementRequest,
  CatalogReplacementPreviewRequest
} from "./parameterCatalogDtos";
import { WiseEffApiError } from "./apiClient";
import { parseContractDto } from "./parseContractDto";
import type {
  CatalogAcceptProposalRequest,
  CatalogCreateBindingDraftRequest,
  CatalogCreateNodeEnablementDraftRequest,
  CatalogCreateProposalRequest,
  CatalogCreatePublicationCandidateRequest,
  CatalogPublishPublicationCandidateRequest,
  CatalogListQuery,
  CatalogRegisterSubjectRequest,
  CatalogRejectProposalRequest,
  CatalogResolveReviewItemRequest,
  CatalogRestoreRegistrationRequest,
  CatalogRetireRegistrationRequest,
  CatalogSubmitProposalRequest,
  CatalogUpdatePlacementRequest,
  CatalogWithdrawProposalRequest
} from "./parameterCatalogDtos";

export type CatalogWriteContext = {
  catalogReleaseId: string;
  idempotencyKey: string;
  ifMatch?: string;
};

/**
 * Governance envelopes carry their conditional-write token beside `item`.
 * The shared DTO schema intentionally validates the item envelope only, so
 * the HTTP owner preserves this response metadata after DTO parsing.
 */
export type CatalogResponseWithEtag<T> = T & {
  etag?: string;
};

type CatalogRequestInit = {
  body?: unknown;
  context?: Partial<CatalogWriteContext>;
  preserveEtag?: boolean;
};

type CatalogClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  authorization?: string;
  getAuthorization?: () => string | undefined | Promise<string | undefined>;
};

const routeById = Object.fromEntries(
  parameterCatalogCanonicalRoutes.map((route) => [route.id, route])
) as {
  [Id in ParameterCatalogCanonicalRouteId]: (typeof parameterCatalogCanonicalRoutes)[number];
};

const forbiddenSpoofHeaderSet = new Set<string>(
  catalogForbiddenSpoofHeaders.map((header) => header.toLowerCase())
);

function fillPath(path: string, params: Record<string, string> = {}) {
  return path.replace(/:([^/]+)/g, (_, name: string) => {
    const value = params[name];
    if (!value) {
      throw new Error(`Missing path parameter ${name}`);
    }
    return encodeURIComponent(value);
  });
}

function appendQuery(path: string, query?: CatalogListQuery) {
  if (!query) return path;
  const params = new URLSearchParams();
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.type) params.set("type", query.type);
  if (query.lifecycle) params.set("lifecycle", query.lifecycle);
  if (query.registration) params.set("registration", query.registration);
  if (query.search) params.set("search", query.search);
  if (query.subjectId) params.set("subjectId", query.subjectId);
  for (const subjectId of query.subjectIds ?? []) {
    params.append("subjectIds", subjectId);
  }
  if (query.placementModuleId) params.set("placementModuleId", query.placementModuleId);
  if (query.propertyKey) params.set("propertyKey", query.propertyKey);
  if (query.catalogReleaseId) params.set("catalogReleaseId", query.catalogReleaseId);
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export function catalogFailureReason(error: WiseEffApiError): CatalogApiFailureReason | "unknown" {
  const parsed = catalogApiFailureReasonSchema.safeParse(error.details.reason);
  return parsed.success ? parsed.data : "unknown";
}

export function catalogFailureClientBehavior(
  reason: CatalogApiFailureReason
): CatalogFailureClientBehavior {
  return catalogFailureClientBehaviors[reason];
}

export function createParameterCatalogClient(options: CatalogClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;

  async function resolveAuthorization() {
    if (!options.getAuthorization) {
      return options.authorization;
    }
    return (await options.getAuthorization()) || options.authorization;
  }

  async function request<T extends ZodTypeAny>(
    method: string,
    path: string,
    schema: T,
    schemaName: string,
    init: CatalogRequestInit = {}
  ): Promise<CatalogResponseWithEtag<z.infer<T>>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const authorization = await resolveAuthorization();
    if (authorization?.trim()) {
      headers.Authorization = authorization;
    }
    if (init.context?.catalogReleaseId) {
      headers[CATALOG_RELEASE_HEADER] = init.context.catalogReleaseId;
    }
    if (init.context?.idempotencyKey) {
      headers[CATALOG_IDEMPOTENCY_HEADER] = init.context.idempotencyKey;
    }
    if (init.context?.ifMatch) {
      headers[CATALOG_IF_MATCH_HEADER] = init.context.ifMatch;
    }
    for (const headerName of Object.keys(headers)) {
      if (forbiddenSpoofHeaderSet.has(headerName.toLowerCase())) {
        delete headers[headerName];
      }
    }

    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = body?.error ?? {};
      throw new WiseEffApiError(
        error.code ?? "INTERNAL_ERROR",
        error.message ?? "Request failed.",
        error.details ?? {},
        error.requestId ?? ""
      );
    }
    const parsed = parseContractDto(schema, body, schemaName);
    if (!init.preserveEtag) {
      return parsed;
    }
    const envelopeEtag =
      body && typeof body === "object" && typeof (body as { etag?: unknown }).etag === "string"
        ? (body as { etag: string }).etag.trim()
        : "";
    const headerEtag = response.headers.get("ETag")?.trim() ?? "";
    const etag = envelopeEtag || headerEtag;
    return etag ? { ...parsed, etag } : parsed;
  }

  function canonical<Id extends ParameterCatalogCanonicalRouteId>(
    id: Id,
    params?: Record<string, string>,
    query?: CatalogListQuery
  ) {
    return appendQuery(fillPath(routeById[id].path, params), query);
  }

  const client = {
    getCatalog: (query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.get", {}, query),
        catalogDocumentResponseSchema,
        "CatalogDocumentResponse"
      ),
    listSubjects: (query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.listSubjects", {}, query),
        catalogSubjectListResponseSchema,
        "CatalogSubjectListResponse"
      ),
    getSubject: (subjectId: string, query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.getSubject", { subjectId }, query),
        catalogSubjectResponseSchema,
        "CatalogSubjectResponse"
      ),
    listSubjectDefinitions: (subjectId: string, query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.listSubjectDefinitions", { subjectId }, query),
        catalogDefinitionListResponseSchema,
        "CatalogDefinitionListResponse"
      ),
    listDefinitions: (query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.listDefinitions", {}, query),
        catalogDefinitionListResponseSchema,
        "CatalogDefinitionListResponse"
      ),
    getDefinition: (definitionId: string, query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.getDefinition", { definitionId }, query),
        catalogDefinitionResponseSchema,
        "CatalogDefinitionResponse"
      ),
    listDefinitionRevisions: (definitionId: string, query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.listDefinitionRevisions", { definitionId }, query),
        catalogDefinitionRevisionListResponseSchema,
        "CatalogDefinitionRevisionListResponse"
      ),
    getDefinitionRevision: (
      definitionId: string,
      revisionId: string,
      query?: CatalogListQuery
    ) =>
      request(
        "GET",
        canonical("catalog.getDefinitionRevision", { definitionId, revisionId }, query),
        catalogDefinitionRevisionResponseSchema,
        "CatalogDefinitionRevisionResponse"
      ),
    listDefinitionTimeline: (definitionId: string, query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.listDefinitionTimeline", { definitionId }, query),
        catalogDefinitionTimelineResponseSchema,
        "CatalogDefinitionTimelineResponse"
      ),
    listRegistrations: (organizationId: string, query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.listRegistrations", { organizationId }, query),
        catalogRegistrationListResponseSchema,
        "CatalogRegistrationListResponse"
      ),
    createRegistration: (
      organizationId: string,
      body: CatalogRegisterSubjectRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        canonical("catalog.createRegistration", { organizationId }),
        catalogRegistrationResponseSchema,
        "CatalogRegistrationResponse",
        {
          body: catalogRegisterSubjectRequestSchema.parse(body),
          context
        }
      ),
    getRegistration: (organizationId: string, registrationId: string) =>
      request(
        "GET",
        canonical("catalog.getRegistration", { organizationId, registrationId }),
        catalogRegistrationResponseSchema,
        "CatalogRegistrationResponse"
      ),
    retireRegistration: (
      organizationId: string,
      registrationId: string,
      body: CatalogRetireRegistrationRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        canonical("catalog.retireRegistration", { organizationId, registrationId }),
        catalogRegistrationResponseSchema,
        "CatalogRegistrationResponse",
        {
          body: catalogRetireRegistrationRequestSchema.parse(body),
          context
        }
      ),
    restoreRegistration: (
      organizationId: string,
      registrationId: string,
      body: CatalogRestoreRegistrationRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        canonical("catalog.restoreRegistration", { organizationId, registrationId }),
        catalogRegistrationResponseSchema,
        "CatalogRegistrationResponse",
        {
          body: catalogRestoreRegistrationRequestSchema.parse(body),
          context
        }
      ),
    getPlacement: (organizationId: string, registrationId: string) =>
      request(
        "GET",
        canonical("catalog.getPlacement", { organizationId, registrationId }),
        catalogPlacementResponseSchema,
        "CatalogPlacementResponse",
        { preserveEtag: true }
      ),
    updatePlacement: (
      organizationId: string,
      registrationId: string,
      body: CatalogUpdatePlacementRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "PATCH",
        canonical("catalog.updatePlacement", { organizationId, registrationId }),
        catalogPlacementResponseSchema,
        "CatalogPlacementResponse",
        {
          body: catalogUpdatePlacementRequestSchema.parse(body),
          context,
          preserveEtag: true
        }
      ),
    listObservations: (organizationId: string, query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.listObservations", { organizationId }, query),
        catalogObservationListResponseSchema,
        "CatalogObservationListResponse"
      ),
    getObservation: (organizationId: string, observationId: string) =>
      request(
        "GET",
        canonical("catalog.getObservation", { organizationId, observationId }),
        catalogObservationResponseSchema,
        "CatalogObservationResponse"
      ),
    listReviewItems: (organizationId: string, query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.listReviewItems", { organizationId }, query),
        catalogReviewItemListResponseSchema,
        "CatalogReviewItemListResponse"
      ),
    getReviewItem: (organizationId: string, reviewItemId: string) =>
      request(
        "GET",
        canonical("catalog.getReviewItem", { organizationId, reviewItemId }),
        catalogReviewItemResponseSchema,
        "CatalogReviewItemResponse"
      ),
    resolveReviewItem: (
      organizationId: string,
      reviewItemId: string,
      body: CatalogResolveReviewItemRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        canonical("catalog.resolveReviewItem", { organizationId, reviewItemId }),
        catalogReviewResolutionResponseSchema,
        "CatalogReviewResolutionResponse",
        {
          body: catalogResolveReviewItemRequestSchema.parse(body),
          context
        }
      ),
    listProposals: (query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.listProposals", {}, query),
        catalogProposalListResponseSchema,
        "CatalogProposalListResponse"
      ),
    createProposal: (body: CatalogCreateProposalRequest, context: CatalogWriteContext) =>
      request(
        "POST",
        canonical("catalog.createProposal"),
        catalogProposalResponseSchema,
        "CatalogProposalResponse",
        {
          body: catalogCreateProposalRequestSchema.parse(body),
          context
        }
      ),
    getProposal: (proposalId: string) =>
      request(
        "GET",
        canonical("catalog.getProposal", { proposalId }),
        catalogProposalResponseSchema,
        "CatalogProposalResponse"
      ),
    submitProposal: (
      proposalId: string,
      body: CatalogSubmitProposalRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        canonical("catalog.submitProposal", { proposalId }),
        catalogProposalResponseSchema,
        "CatalogProposalResponse",
        {
          body: catalogSubmitProposalRequestSchema.parse(body),
          context
        }
      ),
    withdrawProposal: (
      proposalId: string,
      body: CatalogWithdrawProposalRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        canonical("catalog.withdrawProposal", { proposalId }),
        catalogProposalResponseSchema,
        "CatalogProposalResponse",
        {
          body: catalogWithdrawProposalRequestSchema.parse(body),
          context
        }
      ),
    acceptProposal: (
      proposalId: string,
      body: CatalogAcceptProposalRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        canonical("catalog.acceptProposal", { proposalId }),
        catalogProposalResponseSchema,
        "CatalogProposalResponse",
        {
          body: catalogAcceptProposalRequestSchema.parse(body),
          context
        }
      ),
    rejectProposal: (
      proposalId: string,
      body: CatalogRejectProposalRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        canonical("catalog.rejectProposal", { proposalId }),
        catalogProposalResponseSchema,
        "CatalogProposalResponse",
        {
          body: catalogRejectProposalRequestSchema.parse(body),
          context
        }
      ),
    createPublicationCandidate: (
      body: CatalogCreatePublicationCandidateRequest,
      context: Pick<CatalogWriteContext, "catalogReleaseId">
    ) =>
      request(
        "POST",
        canonical("catalog.createPublicationCandidate"),
        catalogPublicationCandidateResponseSchema,
        "CatalogPublicationCandidateResponse",
        {
          body: catalogCreatePublicationCandidateRequestSchema.parse(body),
          context
        }
      ),
    getPublicationCandidate: (candidateId: string) =>
      request(
        "GET",
        canonical("catalog.getPublicationCandidate", { candidateId }),
        catalogPublicationCandidateResponseSchema,
        "CatalogPublicationCandidateResponse"
      ),
    publishPublicationCandidate: (
      candidateId: string,
      body: CatalogPublishPublicationCandidateRequest,
      context: Pick<CatalogWriteContext, "catalogReleaseId">
    ) =>
      request(
        "POST",
        canonical("catalog.publishPublicationCandidate", { candidateId }),
        catalogPublicationJobResponseSchema,
        "CatalogPublicationJobResponse",
        {
          body: catalogPublishPublicationCandidateRequestSchema.parse(body),
          context
        }
      ),
    getPublication: (jobId: string) =>
      request(
        "GET",
        canonical("catalog.getPublication", { jobId }),
        catalogPublicationJobResponseSchema,
        "CatalogPublicationJobResponse"
      ),
    getPublicationSurface: () =>
      request(
        "GET",
        canonical("catalog.getPublicationSurface"),
        catalogPublicationSurfaceResponseSchema,
        "CatalogPublicationSurfaceResponse"
      ),
    listPublications: (query?: CatalogListQuery) =>
      request(
        "GET",
        appendQuery(canonical("catalog.listPublications"), query),
        catalogPublicationJobListResponseSchema,
        "CatalogPublicationJobListResponse"
      ),
    getLegacyIdentifier: (legacyType: string, legacyId: string) =>
      request(
        "GET",
        canonical("catalog.getLegacyIdentifier", {
          legacyType: catalogLegacyIdentifierTypeSchema.parse(legacyType),
          legacyId
        }),
        catalogLegacyIdentifierResponseSchema,
        "CatalogLegacyIdentifierResponse"
      ),
    listProjectBindings: (projectId: string, query?: CatalogListQuery) =>
      request(
        "GET",
        appendQuery(`/api/v2/projects/${encodeURIComponent(projectId)}/parameter-bindings`, query),
        projectParameterBindingListResponseSchema,
        "ProjectParameterBindingListResponse"
      ),
    getCanonicalBindingExport: (projectId: string, bindingId: string, projectValueId?: string) =>
      request(
        "GET",
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-bindings/${encodeURIComponent(bindingId)}/export${projectValueId === undefined ? "" : `?${new URLSearchParams({ projectValueId })}`}`,
        catalogBindingExportResponseSchema,
        "CatalogBindingExportResponse"
      ),
    listProjectValueDrafts: (projectId: string) =>
      request(
        "GET",
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-drafts`,
        projectValueDraftListResponseSchema,
        "ProjectValueDraftListResponse"
      ),
    /**
     * Canonical pending-draft removal. The legacy `DELETE /api/v1/parameter-drafts/:id`
     * targets a different table, so a tray that removed a canonical draft through it
     * silently left the draft alive on the server.
     */
    /**
     * The route enforces auth and project edit permission but no catalog-release or
     * idempotency header (unlike the publication routes), so the context is optional
     * and the request layer simply omits the headers when it is absent.
     */
    deleteProjectValueDraft: (
      projectId: string,
      draftId: string,
      context: Partial<CatalogWriteContext> = {}
    ) =>
      request(
        "DELETE",
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-drafts/${encodeURIComponent(draftId)}`,
        projectValueDraftRemovedResponseSchema,
        "ProjectValueDraftRemovedResponse",
        { context }
      ),
    submitProjectValueDraft: (
      projectId: string,
      draftId: string,
      body: { assignedToUserId?: string | null } = {},
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-drafts/${encodeURIComponent(draftId)}/submit`,
        catalogValueChangeRequestResponseSchema,
        "ProjectValueChangeRequestResponse",
        { body: catalogSubmitValueChangeRequestSchema.parse(body), context }
      ),
    listProjectValueChangeRequests: (projectId: string, query?: { status?: string; mine?: boolean }) =>
      request(
        "GET",
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-change-requests${query?.status || query?.mine !== undefined ? `?${new URLSearchParams({ ...(query?.status ? { status: query.status } : {}), ...(query?.mine !== undefined ? { mine: String(query.mine) } : {}) })}` : ""}`,
        catalogValueChangeRequestListResponseSchema,
        "ProjectValueChangeRequestListResponse"
      ),
    getProjectValueBatchChangeRequest: (projectId: string, requestId: string) =>
      request(
        "GET",
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-change-requests/${encodeURIComponent(requestId)}/batch`,
        catalogBatchValueChangeRequestResponseSchema,
        "ProjectValueBatchChangeRequestResponse"
      ),
    reviewProjectValueChangeRequest: (
      projectId: string,
      requestId: string,
      body: { decision: "approve" | "reject"; note?: string | null; batchProofDigest?: string },
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-change-requests/${encodeURIComponent(requestId)}/review`,
        catalogValueChangeReviewResponseSchema,
        "ProjectValueChangeReviewResponse",
        { body: catalogReviewValueChangeRequestSchema.parse(body), context }
      ),
    getProjectValueChangeSourceDiff: (projectId: string, requestId: string) =>
      request(
        "GET",
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-change-requests/${encodeURIComponent(requestId)}/source-diff`,
        catalogValueChangeSourceDiffResponseSchema,
        "CatalogValueChangeSourceDiffResponse"
      ),
    withdrawProjectValueChangeRequest: (
      projectId: string,
      requestId: string,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-change-requests/${encodeURIComponent(requestId)}/withdraw`,
        catalogValueChangeRequestResponseSchema,
        "ProjectValueChangeRequestResponse",
        { context }
      ),
    getCanonicalBindingChangeHistory: (projectId: string, bindingId: string, limit?: number) =>
      request(
        "GET",
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-bindings/${encodeURIComponent(bindingId)}/change-history${
          limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`
        }`,
        catalogBindingChangeHistoryListResponseSchema,
        "BindingChangeHistoryListResponse"
      ),
    getBindingHistory: (projectId: string, bindingId: string, query?: CatalogListQuery) =>
      request(
        "GET",
        appendQuery(
          `/api/v2/projects/${encodeURIComponent(projectId)}/bindings/${encodeURIComponent(bindingId)}/history`,
          query
        ),
        bindingHistoryListResponseSchema,
        "BindingHistoryListResponse"
      ),
    getBindingCompare: (projectId: string, bindingId: string) =>
      request(
        "GET",
        `/api/v2/projects/${encodeURIComponent(projectId)}/bindings/${encodeURIComponent(bindingId)}/compare`,
        bindingCompareListResponseSchema,
        "BindingCompareListResponse"
      ),
    createBindingDraft: (
      projectId: string,
      bindingId: string,
      body: CatalogCreateBindingDraftRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-bindings/${encodeURIComponent(bindingId)}/drafts`,
        bindingDraftResponseSchema,
        "BindingDraftResponse",
        {
          body: catalogCreateBindingDraftRequestSchema.parse(body),
          context
        }
      ),

    previewDefinitionReplacement: (
      body: CatalogReplacementPreviewRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        canonical("catalog.previewDefinitionReplacement"),
        catalogReplacementPreviewResponseSchema,
        "CatalogReplacementPreviewResponse",
        { body: catalogReplacementPreviewRequestSchema.parse(body), context }
      ),
    listDefinitionReplacements: (query?: CatalogListQuery) =>
      request(
        "GET",
        appendQuery(canonical("catalog.listDefinitionReplacements"), query),
        catalogReplacementListResponseSchema,
        "CatalogReplacementListResponse"
      ),
    createDefinitionReplacement: (
      body: CatalogCreateReplacementRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        canonical("catalog.createDefinitionReplacement"),
        catalogReplacementResponseSchema,
        "CatalogReplacementResponse",
        { body: catalogCreateReplacementRequestSchema.parse(body), context }
      ),
    getDefinitionReplacement: (replacementId: string) =>
      request(
        "GET",
        canonical("catalog.getDefinitionReplacement", { replacementId }),
        catalogReplacementResponseSchema,
        "CatalogReplacementResponse"
      ),
    continueDefinitionReplacement: (
      replacementId: string,
      body: CatalogContinueReplacementRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        canonical("catalog.continueDefinitionReplacement", { replacementId }),
        catalogReplacementResponseSchema,
        "CatalogReplacementResponse",
        { body: catalogContinueReplacementRequestSchema.parse(body), context }
      ),
    createNodeEnablementDraft: (
      projectId: string,
      body: CatalogCreateNodeEnablementDraftRequest,
      context: CatalogWriteContext
    ) =>
      request(
        "POST",
        `/api/v2/projects/${encodeURIComponent(projectId)}/node-enablement-drafts`,
        nodeEnablementDraftResponseSchema,
        "NodeEnablementDraftResponse",
        {
          body: catalogCreateNodeEnablementDraftRequestSchema.parse(body),
          context
        }
      ),
    invokeRetiredLegacyRoute: async (routeId: (typeof parameterCatalogLegacyWriteRouteIds)[number]) => {
      void routeId;
      const gone = await request(
        "POST",
        "/api/v2/parameter-specs",
        catalogLegacyGoneResponseSchema,
        "CatalogLegacyGoneResponse"
      );
      return gone;
    }
  };

  const _methodCoverage: typeof parameterCatalogClientMethodByRouteId = {
    "catalog.get": "getCatalog",
    "catalog.listSubjects": "listSubjects",
    "catalog.getSubject": "getSubject",
    "catalog.listSubjectDefinitions": "listSubjectDefinitions",
    "catalog.listDefinitions": "listDefinitions",
    "catalog.getDefinition": "getDefinition",
    "catalog.listDefinitionRevisions": "listDefinitionRevisions",
    "catalog.getDefinitionRevision": "getDefinitionRevision",
    "catalog.listDefinitionTimeline": "listDefinitionTimeline",
    "catalog.listRegistrations": "listRegistrations",
    "catalog.createRegistration": "createRegistration",
    "catalog.getRegistration": "getRegistration",
    "catalog.retireRegistration": "retireRegistration",
    "catalog.restoreRegistration": "restoreRegistration",
    "catalog.getPlacement": "getPlacement",
    "catalog.updatePlacement": "updatePlacement",
    "catalog.listObservations": "listObservations",
    "catalog.getObservation": "getObservation",
    "catalog.listReviewItems": "listReviewItems",
    "catalog.getReviewItem": "getReviewItem",
    "catalog.resolveReviewItem": "resolveReviewItem",
    "catalog.listProposals": "listProposals",
    "catalog.createProposal": "createProposal",
    "catalog.getProposal": "getProposal",
    "catalog.submitProposal": "submitProposal",
    "catalog.withdrawProposal": "withdrawProposal",
    "catalog.acceptProposal": "acceptProposal",
    "catalog.rejectProposal": "rejectProposal",
    "catalog.createPublicationCandidate": "createPublicationCandidate",
    "catalog.getPublicationCandidate": "getPublicationCandidate",
    "catalog.publishPublicationCandidate": "publishPublicationCandidate",
    "catalog.getPublication": "getPublication",
    "catalog.getPublicationSurface": "getPublicationSurface",
    "catalog.listPublications": "listPublications",
    "catalog.getLegacyIdentifier": "getLegacyIdentifier",
    "catalog.previewDefinitionReplacement": "previewDefinitionReplacement",
    "catalog.listDefinitionReplacements": "listDefinitionReplacements",
    "catalog.createDefinitionReplacement": "createDefinitionReplacement",
    "catalog.getDefinitionReplacement": "getDefinitionReplacement",
    "catalog.continueDefinitionReplacement": "continueDefinitionReplacement"
  };
  void _methodCoverage;

  return client;
}

export type ParameterCatalogClient = ReturnType<typeof createParameterCatalogClient>;
