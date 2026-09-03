import type { ZodTypeAny, z } from "zod";

import {
  bindingDraftResponseSchema,
  bindingCompareListResponseSchema,
  bindingHistoryListResponseSchema,
  catalogAcceptProposalRequestSchema,
  catalogCreateBindingDraftRequestSchema,
  catalogCreateNodeEnablementDraftRequestSchema,
  catalogCreateProposalRequestSchema,
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
  type CatalogApiFailureReason,
  type CatalogFailureClientBehavior,
  type ParameterCatalogCanonicalRouteId
} from "@wiseeff/dto-schemas";
import { WiseEffApiError } from "./apiClient";
import { parseContractDto } from "./parseContractDto";
import type {
  CatalogAcceptProposalRequest,
  CatalogCreateBindingDraftRequest,
  CatalogCreateNodeEnablementDraftRequest,
  CatalogCreateProposalRequest,
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

type CatalogWriteContext = {
  catalogReleaseId: string;
  idempotencyKey: string;
  ifMatch?: string;
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
  if (query.propertyKey) params.set("propertyKey", query.propertyKey);
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
    init: {
      body?: unknown;
      context?: Partial<CatalogWriteContext>;
    } = {}
  ): Promise<z.infer<T>> {
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
    return parseContractDto(schema, body, schemaName);
  }

  function canonical<Id extends ParameterCatalogCanonicalRouteId>(
    id: Id,
    params?: Record<string, string>,
    query?: CatalogListQuery
  ) {
    return appendQuery(fillPath(routeById[id].path, params), query);
  }

  const client = {
    getCatalog: () =>
      request("GET", canonical("catalog.get"), catalogDocumentResponseSchema, "CatalogDocumentResponse"),
    listSubjects: (query?: CatalogListQuery) =>
      request(
        "GET",
        canonical("catalog.listSubjects", {}, query),
        catalogSubjectListResponseSchema,
        "CatalogSubjectListResponse"
      ),
    getSubject: (subjectId: string) =>
      request(
        "GET",
        canonical("catalog.getSubject", { subjectId }),
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
    getDefinition: (definitionId: string) =>
      request(
        "GET",
        canonical("catalog.getDefinition", { definitionId }),
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
    getDefinitionRevision: (definitionId: string, revisionId: string) =>
      request(
        "GET",
        canonical("catalog.getDefinitionRevision", { definitionId, revisionId }),
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
        "CatalogPlacementResponse"
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
          context
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
    "catalog.getLegacyIdentifier": "getLegacyIdentifier"
  };
  void _methodCoverage;

  return client;
}

export type ParameterCatalogClient = ReturnType<typeof createParameterCatalogClient>;
