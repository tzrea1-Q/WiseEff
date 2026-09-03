import { z } from "zod";

import {
  catalogSubjectKinds,
  definitionLifecycles,
  definitionProposalStatuses,
  emptyReasons,
  legacyLookupIdentifierTypes,
  registrationStatuses,
  reviewItemStatuses,
  reviewReasons,
  reviewResolutionTypes,
  subjectLifecycles
} from "../../parameter-catalog-contract/index";
import { itemEnvelopeSchema } from "./envelopes";

export const pcatApiGates = [
  "PCAT-API-01",
  "PCAT-API-02",
  "PCAT-API-03",
  "PCAT-API-04",
  "PCAT-API-05",
  "PCAT-API-06",
  "PCAT-API-07",
  "PCAT-API-08",
  "PCAT-API-09",
  "PCAT-API-10",
  "PCAT-API-11",
  "PCAT-API-12"
] as const;
export type PcatApiGate = (typeof pcatApiGates)[number];

export const catalogApiFailureReasons = [
  "catalog-not-ready",
  "release-drift",
  "subject-not-published",
  "subject-retired",
  "definition-not-found",
  "definition-retired",
  "registration-required",
  "placement-conflict",
  "invalid-placement-parent",
  "observation-ambiguous",
  "proposal-stale",
  "proposal-self-approval-forbidden",
  "revision-conflict",
  "legacy-id-archived",
  "legacy-surface-retired",
  "legacy-id-ambiguous",
  "forbidden",
  "migration-diagnostics-not-public"
] as const;
export type CatalogApiFailureReason = (typeof catalogApiFailureReasons)[number];

export const catalogFailureClientBehaviors = {
  "catalog-not-ready": "disable-writes-retry-after",
  "release-drift": "refresh-and-reconfirm",
  "subject-not-published": "show-not-found-no-create",
  "subject-retired": "show-lifecycle-no-restore",
  "definition-not-found": "show-not-found",
  "definition-retired": "historical-read-block-mutation",
  "registration-required": "offer-explicit-registration",
  "placement-conflict": "refresh-placement-reconfirm",
  "invalid-placement-parent": "keep-review-unresolved",
  "observation-ambiguous": "open-review-item",
  "proposal-stale": "rebase-proposal",
  "proposal-self-approval-forbidden": "require-other-platform-admin",
  "revision-conflict": "refresh-no-silent-retry",
  "legacy-id-archived": "historical-unavailable",
  "legacy-surface-retired": "migrate-to-successor-no-retry",
  "legacy-id-ambiguous": "no-candidate-disclosure",
  forbidden: "hide-out-of-scope",
  "migration-diagnostics-not-public": "treat-as-not-found"
} as const satisfies Record<CatalogApiFailureReason, string>;
export type CatalogFailureClientBehavior =
  (typeof catalogFailureClientBehaviors)[CatalogApiFailureReason];

export const catalogApiErrorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "GONE",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR"
] as const;

export const CATALOG_RELEASE_HEADER = "X-WiseEff-Catalog-Release";
export const CATALOG_IF_MATCH_HEADER = "If-Match";
export const CATALOG_IDEMPOTENCY_HEADER = "Idempotency-Key";
export const CATALOG_ETAG_HEADER = "ETag";
export const CATALOG_RETRY_AFTER_HEADER = "Retry-After";
export const CATALOG_DEPRECATION_HEADER = "Deprecation";
export const CATALOG_SUNSET_HEADER = "Sunset";
export const CATALOG_LINK_HEADER = "Link";
export const CATALOG_WARNING_HEADER = "Warning";
export const CATALOG_LEGACY_CONTRACT_HEADER = "X-WiseEff-Legacy-Contract";

export const catalogForbiddenSpoofHeaders = [
  "X-WiseEff-Role",
  "X-WiseEff-Organization",
  "X-WiseEff-Actor-Kind",
  "X-WiseEff-Agent"
] as const;

export const catalogMappingTargetKinds = [
  "catalog-subject",
  "parameter-definition",
  "definition-revision",
  "subject-registration",
  "subject-placement",
  "parameter-binding",
  "project-value",
  "binding-history-event",
  "parameter-observation",
  "observation-match",
  "review-evidence",
  "review-item",
  "review-resolution",
  "definition-proposal",
  "definition-proposal-revision",
  "publication-intent",
  "policy",
  "audit-event",
  "migration-history"
] as const;

export const catalogKernelReadOperations = [
  "loadCurrentCatalog",
  "listSubjects",
  "getSubject",
  "listDefinitions",
  "getDefinitionById",
  "listDefinitionRevisions",
  "getDefinitionRevision",
  "listDefinitionTimelineFacts"
] as const;

const camelLegacySpecKey = ["parameter", "Spec", "Id"].join("");
const snakeLegacySpecKey = ["parameter", "spec", "id"].join("_");

function rejectLegacySpecKeys(value: unknown, ctx: z.RefinementCtx) {
  if (!value || typeof value !== "object") {
    return;
  }
  const visit = (entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    const record = entry as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, camelLegacySpecKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "canonical catalog wire rejects legacy spec identity"
      });
    }
    if (Object.prototype.hasOwnProperty.call(record, snakeLegacySpecKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "canonical catalog wire rejects legacy spec identity"
      });
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(value);
}

function catalogObject<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.object(shape).strict().superRefine(rejectLegacySpecKeys);
}

function closedEnum<T extends string>(values: readonly T[]) {
  return z.enum(values as [T, ...T[]]);
}

export const catalogApiFailureReasonSchema = closedEnum(catalogApiFailureReasons);
export const catalogSubjectTypeSchema = closedEnum(catalogSubjectKinds);
export const catalogSubjectLifecycleSchema = closedEnum(subjectLifecycles);
export const catalogDefinitionLifecycleSchema = closedEnum(definitionLifecycles);
export const catalogRegistrationStatusSchema = closedEnum(registrationStatuses);
export const catalogEmptyReasonSchema = closedEnum(emptyReasons);
export const catalogReviewItemStatusSchema = closedEnum(reviewItemStatuses);
export const catalogReviewReasonSchema = closedEnum(reviewReasons);
export const catalogReviewResolutionTypeSchema = closedEnum(reviewResolutionTypes);
export const catalogProposalStatusSchema = closedEnum(definitionProposalStatuses);
export const catalogLegacyIdentifierTypeSchema = closedEnum(legacyLookupIdentifierTypes);
export const catalogMappingTargetKindSchema = closedEnum(catalogMappingTargetKinds);
export const catalogRegistrationMethodSchema = z.enum(["explicit", "automatic", "review"]);
export const catalogReadinessStatusSchema = z.enum(["ready"]);

export const catalogPlacementIntentSchema = z.union([
  catalogObject({ mode: z.literal("use-default") }),
  catalogObject({
    mode: z.literal("choose-parent"),
    parentPlacementId: z.string(),
    displayName: z.string()
  })
]);

export const catalogCursorQuerySchema = catalogObject({
  cursor: z.string().optional(),
  limit: z.number().int().positive().optional()
});

function catalogItemsEnvelopeSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return catalogObject({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
    catalogReleaseId: z.string(),
    emptyReason: catalogEmptyReasonSchema.optional()
  });
}

export const catalogReleasePinSchema = catalogObject({
  id: z.string(),
  digest: z.string()
});

export const catalogDocumentDtoSchema = catalogObject({
  catalogReleaseId: z.string(),
  releaseName: z.string(),
  releaseSequence: z.number().int(),
  publishedAt: z.string(),
  materializedAt: z.string(),
  status: catalogReadinessStatusSchema,
  digest: z.string(),
  materializationFingerprint: z.string(),
  links: catalogObject({
    subjects: z.string(),
    definitions: z.string()
  })
});

export const catalogPlacementDtoSchema = catalogObject({
  id: z.string(),
  displayName: z.string(),
  parentPlacementId: z.string().nullable()
});

export const catalogRegistrationProjectionSchema = z.union([
  catalogObject({ status: z.literal("unregistered") }),
  catalogObject({
    status: catalogRegistrationStatusSchema,
    id: z.string(),
    method: catalogRegistrationMethodSchema.optional(),
    placement: catalogPlacementDtoSchema.optional()
  })
]);

export const catalogSubjectDtoSchema = catalogObject({
  id: z.string(),
  type: catalogSubjectTypeSchema,
  canonicalName: z.string(),
  membership: catalogObject({
    status: catalogSubjectLifecycleSchema,
    catalogReleaseId: z.string()
  }),
  registration: catalogRegistrationProjectionSchema,
  definitionCounts: catalogObject({
    active: z.number().int().nonnegative(),
    deprecated: z.number().int().nonnegative(),
    retired: z.number().int().nonnegative()
  }),
  reviewCount: z.number().int().nonnegative().optional(),
  availableActions: z.array(z.literal("register")).optional()
});

export const catalogValueShapeSchema = catalogObject({
  kind: z.literal("json-schema"),
  schema: z.record(z.string(), z.unknown())
});

export const catalogConstraintsSchema = catalogObject({
  kind: z.literal("none")
});

export const catalogDefinitionRevisionDtoSchema = catalogObject({
  id: z.string(),
  definitionId: z.string(),
  revisionNumber: z.number().int().positive(),
  contentDigest: z.string(),
  valueShape: catalogValueShapeSchema,
  constraints: catalogConstraintsSchema,
  documentation: z.string().nullable(),
  publishedInCatalogReleaseId: z.string()
});

export const catalogDefinitionDtoSchema = catalogObject({
  id: z.string(),
  subject: catalogObject({
    id: z.string(),
    type: catalogSubjectTypeSchema,
    canonicalName: z.string()
  }),
  propertyKey: z.string(),
  lifecycle: catalogDefinitionLifecycleSchema,
  currentRevision: catalogDefinitionRevisionDtoSchema,
  registration: catalogRegistrationProjectionSchema,
  usageSummary: catalogObject({
    policyCount: z.number().int().nonnegative(),
    projectCount: z.number().int().nonnegative(),
    currentValueCount: z.number().int().nonnegative()
  }),
  links: catalogObject({
    revisions: z.string(),
    timeline: z.string()
  })
});

export const catalogTimelineFactDtoSchema = catalogObject({
  id: z.string(),
  kind: z.enum(["catalog-publication", "history", "audit"]),
  definitionId: z.string(),
  revisionId: z.string().nullable(),
  revisionNumber: z.number().int().positive().nullable(),
  catalogReleaseId: z.string().nullable(),
  publishedAt: z.string(),
  changes: z.array(z.enum(["introduced", "content", "documentation", "lifecycle"])).optional(),
  summary: z.string().optional()
});

export const catalogRegistrationDtoSchema = catalogObject({
  id: z.string(),
  organizationId: z.string(),
  subjectId: z.string(),
  status: catalogRegistrationStatusSchema,
  method: catalogRegistrationMethodSchema,
  placement: catalogPlacementDtoSchema,
  catalogReleaseId: z.string()
});

export const catalogRegisterSubjectRequestSchema = catalogObject({
  subjectId: z.string(),
  placement: catalogPlacementIntentSchema,
  reason: z.string().optional()
});

export const catalogRetireRegistrationRequestSchema = catalogObject({
  reason: z.string()
});

export const catalogRestoreRegistrationRequestSchema = catalogObject({
  reason: z.string()
});

export const catalogUpdatePlacementRequestSchema = catalogObject({
  placement: catalogPlacementIntentSchema
});

export const catalogObservationDtoSchema = catalogObject({
  id: z.string(),
  organizationId: z.string(),
  propertyKey: z.string(),
  sourceRef: catalogObject({
    kind: z.string(),
    id: z.string()
  }),
  recognition: z.enum(["unknown", "ambiguous", "matched", "retired"]),
  reviewItemId: z.string().nullable()
});

export const catalogReviewCandidateDtoSchema = catalogObject({
  subjectId: z.string(),
  evidence: z.array(z.string())
});

export const catalogReviewItemDtoSchema = catalogObject({
  id: z.string(),
  organizationId: z.string(),
  reason: catalogReviewReasonSchema,
  status: catalogReviewItemStatusSchema,
  etag: z.string(),
  catalogReleaseId: z.string(),
  observation: catalogObject({
    id: z.string(),
    propertyKey: z.string(),
    sourceRef: catalogObject({
      kind: z.string(),
      id: z.string()
    })
  }).optional(),
  candidates: z.array(catalogReviewCandidateDtoSchema),
  allowedResolutions: z.array(catalogReviewResolutionTypeSchema),
  candidateState: z.union([
    catalogObject({
      status: z.literal("current"),
      capturedRelease: catalogReleasePinSchema
    }),
    catalogObject({
      status: z.literal("stale"),
      capturedRelease: catalogReleasePinSchema,
      currentRelease: catalogReleasePinSchema.nullable()
    })
  ])
});

export const catalogResolveReviewItemRequestSchema = catalogObject({
  resolution: z.union([
    catalogObject({
      type: z.literal("register-subject"),
      subjectId: z.string(),
      placement: catalogPlacementIntentSchema
    }),
    catalogObject({
      type: z.literal("restore-registration"),
      registrationId: z.string()
    }),
    catalogObject({
      type: z.literal("mark-out-of-scope")
    }),
    catalogObject({
      type: z.literal("open-definition-proposal")
    })
  ]),
  reason: z.string()
});

export const catalogReviewResolutionDtoSchema = catalogObject({
  reviewItem: catalogObject({
    id: z.string(),
    status: z.enum(["resolved", "out-of-scope"])
  }),
  registration: catalogObject({
    id: z.string(),
    subjectId: z.string(),
    placement: catalogPlacementDtoSchema
  }).optional(),
  proposalId: z.string().optional(),
  catalogReleaseId: z.string()
});

export const catalogProposalDtoSchema = catalogObject({
  id: z.string(),
  organizationId: z.string(),
  status: catalogProposalStatusSchema,
  etag: z.string(),
  base: catalogObject({
    catalogReleaseId: z.string(),
    definitionId: z.string().nullable(),
    definitionRevisionId: z.string().nullable()
  }),
  requestedChange: z.object({ kind: z.string() }).passthrough(),
  submittedByPersonId: z.string().nullable(),
  acceptedByPersonId: z.string().nullable(),
  publicationIntentRef: z.string().nullable(),
  version: z.number().int().positive()
});

export const catalogCreateProposalRequestSchema = catalogObject({
  base: catalogObject({
    catalogReleaseId: z.string(),
    definitionId: z.string().optional(),
    definitionRevisionId: z.string().optional()
  }),
  requestedChange: z.object({ kind: z.string() }).passthrough(),
  reason: z.string(),
  evidenceRefs: z.array(z.string()).optional()
});

export const catalogSubmitProposalRequestSchema = catalogObject({
  reason: z.string().optional()
});

export const catalogWithdrawProposalRequestSchema = catalogObject({
  reason: z.string().optional()
});

export const catalogAcceptProposalRequestSchema = catalogObject({
  repositoryReference: z.string()
});

export const catalogRejectProposalRequestSchema = catalogObject({
  reason: z.string()
});

export const catalogLegacyIdentifierDtoSchema = catalogObject({
  legacyType: catalogLegacyIdentifierTypeSchema,
  legacyId: z.string(),
  disposition: z.literal("mapped"),
  target: catalogObject({
    kind: catalogMappingTargetKindSchema,
    id: z.string(),
    href: z.string()
  }),
  historicalOnly: z.boolean()
});

export const catalogLegacyGoneResponseSchema = catalogObject({
  error: catalogObject({
    code: z.literal("GONE"),
    message: z.string(),
    details: catalogObject({
      reason: z.literal("legacy-surface-retired"),
      successor: z.string(),
      retryable: z.literal(false)
    }),
    requestId: z.string()
  })
});

export const catalogProjectBindingDtoSchema = catalogObject({
  id: z.string(),
  projectId: z.string(),
  logicalNodeId: z.string(),
  subjectRegistrationId: z.string(),
  definitionId: z.string(),
  effectiveRevisionId: z.string(),
  currentValueId: z.string(),
  recognizedAgainstCatalogReleaseId: z.string()
});

export const catalogBindingHistoryEntryDtoSchema = catalogObject({
  id: z.string(),
  bindingId: z.string(),
  definitionId: z.string(),
  effectiveRevisionId: z.string(),
  currentValueId: z.string(),
  recordedAt: z.string()
});

export const catalogBindingCompareEntryDtoSchema = catalogObject({
  projectId: z.string(),
  bindingId: z.string(),
  definitionId: z.string(),
  effectiveRevisionId: z.string(),
  currentValueId: z.string()
});

export const catalogCreateBindingDraftRequestSchema = catalogObject({
  definitionId: z.string(),
  effectiveRevisionId: z.string(),
  currentValueId: z.string().optional(),
  targetValue: z.string(),
  reason: z.string()
});

export const catalogBindingDraftDtoSchema = catalogObject({
  id: z.string(),
  bindingId: z.string(),
  definitionId: z.string(),
  effectiveRevisionId: z.string(),
  currentValueId: z.string().nullable(),
  targetValue: z.string()
});

export const catalogCreateNodeEnablementDraftRequestSchema = catalogObject({
  logicalNodeId: z.string(),
  definitionId: z.string(),
  effectiveRevisionId: z.string(),
  enabled: z.boolean(),
  reason: z.string()
});

export const catalogNodeEnablementDraftDtoSchema = catalogObject({
  id: z.string(),
  logicalNodeId: z.string(),
  definitionId: z.string(),
  effectiveRevisionId: z.string(),
  enabled: z.boolean()
});

export const catalogDocumentResponseSchema = itemEnvelopeSchema(catalogDocumentDtoSchema).superRefine(
  rejectLegacySpecKeys
);
export const catalogSubjectListResponseSchema = catalogItemsEnvelopeSchema(catalogSubjectDtoSchema);
export const catalogSubjectResponseSchema = itemEnvelopeSchema(catalogSubjectDtoSchema).superRefine(
  rejectLegacySpecKeys
);
export const catalogDefinitionListResponseSchema = catalogItemsEnvelopeSchema(catalogDefinitionDtoSchema);
export const catalogDefinitionResponseSchema = itemEnvelopeSchema(catalogDefinitionDtoSchema).superRefine(
  rejectLegacySpecKeys
);
export const catalogDefinitionRevisionListResponseSchema = catalogItemsEnvelopeSchema(
  catalogDefinitionRevisionDtoSchema
);
export const catalogDefinitionRevisionResponseSchema = itemEnvelopeSchema(
  catalogDefinitionRevisionDtoSchema
).superRefine(rejectLegacySpecKeys);
export const catalogDefinitionTimelineResponseSchema = catalogItemsEnvelopeSchema(
  catalogTimelineFactDtoSchema
);
export const catalogRegistrationListResponseSchema = catalogItemsEnvelopeSchema(
  catalogRegistrationDtoSchema
);
export const catalogRegistrationResponseSchema = itemEnvelopeSchema(catalogRegistrationDtoSchema).superRefine(
  rejectLegacySpecKeys
);
export const catalogPlacementResponseSchema = itemEnvelopeSchema(catalogPlacementDtoSchema).superRefine(
  rejectLegacySpecKeys
);
export const catalogObservationListResponseSchema = catalogItemsEnvelopeSchema(catalogObservationDtoSchema);
export const catalogObservationResponseSchema = itemEnvelopeSchema(catalogObservationDtoSchema).superRefine(
  rejectLegacySpecKeys
);
export const catalogReviewItemListResponseSchema = catalogItemsEnvelopeSchema(catalogReviewItemDtoSchema);
export const catalogReviewItemResponseSchema = itemEnvelopeSchema(catalogReviewItemDtoSchema).superRefine(
  rejectLegacySpecKeys
);
export const catalogReviewResolutionResponseSchema = itemEnvelopeSchema(
  catalogReviewResolutionDtoSchema
).superRefine(rejectLegacySpecKeys);
export const catalogProposalListResponseSchema = catalogItemsEnvelopeSchema(catalogProposalDtoSchema);
export const catalogProposalResponseSchema = itemEnvelopeSchema(catalogProposalDtoSchema).superRefine(
  rejectLegacySpecKeys
);
export const catalogLegacyIdentifierResponseSchema = itemEnvelopeSchema(
  catalogLegacyIdentifierDtoSchema
).superRefine(rejectLegacySpecKeys);
export const projectParameterBindingListResponseSchema = catalogItemsEnvelopeSchema(
  catalogProjectBindingDtoSchema
);
export const bindingHistoryListResponseSchema = catalogItemsEnvelopeSchema(
  catalogBindingHistoryEntryDtoSchema
);
export const bindingCompareListResponseSchema = catalogItemsEnvelopeSchema(
  catalogBindingCompareEntryDtoSchema
);
export const bindingDraftResponseSchema = itemEnvelopeSchema(catalogBindingDraftDtoSchema).superRefine(
  rejectLegacySpecKeys
);
export const nodeEnablementDraftResponseSchema = itemEnvelopeSchema(
  catalogNodeEnablementDraftDtoSchema
).superRefine(rejectLegacySpecKeys);

export const parameterCatalogDtoSchemaCatalog = {
  CatalogDocumentResponse: catalogDocumentResponseSchema,
  CatalogSubjectListResponse: catalogSubjectListResponseSchema,
  CatalogSubjectResponse: catalogSubjectResponseSchema,
  CatalogDefinitionListResponse: catalogDefinitionListResponseSchema,
  CatalogDefinitionResponse: catalogDefinitionResponseSchema,
  CatalogDefinitionRevisionListResponse: catalogDefinitionRevisionListResponseSchema,
  CatalogDefinitionRevisionResponse: catalogDefinitionRevisionResponseSchema,
  CatalogDefinitionTimelineResponse: catalogDefinitionTimelineResponseSchema,
  CatalogRegistrationListResponse: catalogRegistrationListResponseSchema,
  CatalogRegisterSubjectRequest: catalogRegisterSubjectRequestSchema,
  CatalogRegistrationResponse: catalogRegistrationResponseSchema,
  CatalogRetireRegistrationRequest: catalogRetireRegistrationRequestSchema,
  CatalogRestoreRegistrationRequest: catalogRestoreRegistrationRequestSchema,
  CatalogPlacementResponse: catalogPlacementResponseSchema,
  CatalogUpdatePlacementRequest: catalogUpdatePlacementRequestSchema,
  CatalogObservationListResponse: catalogObservationListResponseSchema,
  CatalogObservationResponse: catalogObservationResponseSchema,
  CatalogReviewItemListResponse: catalogReviewItemListResponseSchema,
  CatalogReviewItemResponse: catalogReviewItemResponseSchema,
  CatalogResolveReviewItemRequest: catalogResolveReviewItemRequestSchema,
  CatalogReviewResolutionResponse: catalogReviewResolutionResponseSchema,
  CatalogProposalListResponse: catalogProposalListResponseSchema,
  CatalogCreateProposalRequest: catalogCreateProposalRequestSchema,
  CatalogProposalResponse: catalogProposalResponseSchema,
  CatalogSubmitProposalRequest: catalogSubmitProposalRequestSchema,
  CatalogWithdrawProposalRequest: catalogWithdrawProposalRequestSchema,
  CatalogAcceptProposalRequest: catalogAcceptProposalRequestSchema,
  CatalogRejectProposalRequest: catalogRejectProposalRequestSchema,
  CatalogLegacyIdentifierResponse: catalogLegacyIdentifierResponseSchema,
  CatalogLegacyGoneResponse: catalogLegacyGoneResponseSchema,
  ProjectParameterBindingListResponse: projectParameterBindingListResponseSchema,
  BindingHistoryListResponse: bindingHistoryListResponseSchema,
  BindingCompareListResponse: bindingCompareListResponseSchema,
  CreateBindingDraftRequest: catalogCreateBindingDraftRequestSchema,
  BindingDraftResponse: bindingDraftResponseSchema,
  CreateNodeEnablementDraftRequest: catalogCreateNodeEnablementDraftRequestSchema,
  NodeEnablementDraftResponse: nodeEnablementDraftResponseSchema
} as const;

const catalogReleaseRequestHeader = {
  name: CATALOG_RELEASE_HEADER,
  in: "header" as const,
  required: true,
  description: "Catalog release observed by the client."
};

const catalogIdempotencyHeader = {
  name: CATALOG_IDEMPOTENCY_HEADER,
  in: "header" as const,
  required: true,
  description: "Idempotency key for governance writes."
};

const catalogIfMatchHeader = {
  name: CATALOG_IF_MATCH_HEADER,
  in: "header" as const,
  required: true,
  description: "ETag of the mutable catalog resource."
};

const catalogReleaseResponseHeader = {
  name: CATALOG_RELEASE_HEADER,
  required: true,
  description: "Catalog release that produced this response."
};

const catalogEtagResponseHeader = {
  name: CATALOG_ETAG_HEADER,
  required: true,
  description: "Opaque ETag for If-Match on the next mutation."
};

const pageQueryParameters = [
  {
    name: "cursor",
    in: "query" as const,
    required: false,
    description: "Opaque catalog cursor bound to the release."
  },
  {
    name: "limit",
    in: "query" as const,
    required: false,
    schema: { type: "integer" as const },
    description: "Bounded page size."
  }
];

export const parameterCatalogCanonicalRoutes = [
  { id: "catalog.get", method: "GET", path: "/api/v2/catalog", module: "catalog", stability: "mvp" },
  { id: "catalog.listSubjects", method: "GET", path: "/api/v2/catalog/subjects", module: "catalog", stability: "mvp" },
  {
    id: "catalog.getSubject",
    method: "GET",
    path: "/api/v2/catalog/subjects/:subjectId",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.listSubjectDefinitions",
    method: "GET",
    path: "/api/v2/catalog/subjects/:subjectId/definitions",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.listDefinitions",
    method: "GET",
    path: "/api/v2/catalog/definitions",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getDefinition",
    method: "GET",
    path: "/api/v2/catalog/definitions/:definitionId",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.listDefinitionRevisions",
    method: "GET",
    path: "/api/v2/catalog/definitions/:definitionId/revisions",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getDefinitionRevision",
    method: "GET",
    path: "/api/v2/catalog/definitions/:definitionId/revisions/:revisionId",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.listDefinitionTimeline",
    method: "GET",
    path: "/api/v2/catalog/definitions/:definitionId/timeline",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.listRegistrations",
    method: "GET",
    path: "/api/v2/organizations/:organizationId/subject-registrations",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.createRegistration",
    method: "POST",
    path: "/api/v2/organizations/:organizationId/subject-registrations",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getRegistration",
    method: "GET",
    path: "/api/v2/organizations/:organizationId/subject-registrations/:registrationId",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.retireRegistration",
    method: "POST",
    path: "/api/v2/organizations/:organizationId/subject-registrations/:registrationId/retire",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.restoreRegistration",
    method: "POST",
    path: "/api/v2/organizations/:organizationId/subject-registrations/:registrationId/restore",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getPlacement",
    method: "GET",
    path: "/api/v2/organizations/:organizationId/subject-registrations/:registrationId/placement",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.updatePlacement",
    method: "PATCH",
    path: "/api/v2/organizations/:organizationId/subject-registrations/:registrationId/placement",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.listObservations",
    method: "GET",
    path: "/api/v2/organizations/:organizationId/parameter-observations",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getObservation",
    method: "GET",
    path: "/api/v2/organizations/:organizationId/parameter-observations/:observationId",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.listReviewItems",
    method: "GET",
    path: "/api/v2/organizations/:organizationId/parameter-review-items",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getReviewItem",
    method: "GET",
    path: "/api/v2/organizations/:organizationId/parameter-review-items/:reviewItemId",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.resolveReviewItem",
    method: "POST",
    path: "/api/v2/organizations/:organizationId/parameter-review-items/:reviewItemId/resolve",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.listProposals",
    method: "GET",
    path: "/api/v2/catalog/definition-proposals",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.createProposal",
    method: "POST",
    path: "/api/v2/catalog/definition-proposals",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getProposal",
    method: "GET",
    path: "/api/v2/catalog/definition-proposals/:proposalId",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.submitProposal",
    method: "POST",
    path: "/api/v2/catalog/definition-proposals/:proposalId/submit",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.withdrawProposal",
    method: "POST",
    path: "/api/v2/catalog/definition-proposals/:proposalId/withdraw",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.acceptProposal",
    method: "POST",
    path: "/api/v2/catalog/definition-proposals/:proposalId/accept",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.rejectProposal",
    method: "POST",
    path: "/api/v2/catalog/definition-proposals/:proposalId/reject",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getLegacyIdentifier",
    method: "GET",
    path: "/api/v2/catalog/legacy-identifiers/:legacyType/:legacyId",
    module: "catalog",
    stability: "mvp"
  }
] as const;

export type ParameterCatalogCanonicalRouteId =
  (typeof parameterCatalogCanonicalRoutes)[number]["id"];

export const parameterCatalogRouteGates: Record<
  ParameterCatalogCanonicalRouteId,
  readonly PcatApiGate[]
> = {
  "catalog.get": ["PCAT-API-01", "PCAT-API-11"],
  "catalog.listSubjects": ["PCAT-API-02", "PCAT-API-11"],
  "catalog.getSubject": ["PCAT-API-02", "PCAT-API-11"],
  "catalog.listSubjectDefinitions": ["PCAT-API-02", "PCAT-API-11"],
  "catalog.listDefinitions": ["PCAT-API-02", "PCAT-API-11"],
  "catalog.getDefinition": ["PCAT-API-02", "PCAT-API-11"],
  "catalog.listDefinitionRevisions": ["PCAT-API-03", "PCAT-API-11"],
  "catalog.getDefinitionRevision": ["PCAT-API-03", "PCAT-API-11"],
  "catalog.listDefinitionTimeline": ["PCAT-API-03", "PCAT-API-11"],
  "catalog.listRegistrations": ["PCAT-API-04"],
  "catalog.createRegistration": ["PCAT-API-04", "PCAT-API-10"],
  "catalog.getRegistration": ["PCAT-API-04"],
  "catalog.retireRegistration": ["PCAT-API-04", "PCAT-API-10"],
  "catalog.restoreRegistration": ["PCAT-API-04", "PCAT-API-10"],
  "catalog.getPlacement": ["PCAT-API-04"],
  "catalog.updatePlacement": ["PCAT-API-04", "PCAT-API-10"],
  "catalog.listObservations": ["PCAT-API-05"],
  "catalog.getObservation": ["PCAT-API-05"],
  "catalog.listReviewItems": ["PCAT-API-05"],
  "catalog.getReviewItem": ["PCAT-API-05"],
  "catalog.resolveReviewItem": ["PCAT-API-05", "PCAT-API-10"],
  "catalog.listProposals": ["PCAT-API-06"],
  "catalog.createProposal": ["PCAT-API-06", "PCAT-API-10"],
  "catalog.getProposal": ["PCAT-API-06"],
  "catalog.submitProposal": ["PCAT-API-06", "PCAT-API-10"],
  "catalog.withdrawProposal": ["PCAT-API-06", "PCAT-API-10"],
  "catalog.acceptProposal": ["PCAT-API-06", "PCAT-API-09", "PCAT-API-10"],
  "catalog.rejectProposal": ["PCAT-API-06", "PCAT-API-09", "PCAT-API-10"],
  "catalog.getLegacyIdentifier": ["PCAT-API-07"]
};

export const parameterCatalogKernelReadByRouteId = {
  "catalog.get": "loadCurrentCatalog",
  "catalog.listSubjects": "listSubjects",
  "catalog.getSubject": "getSubject",
  "catalog.listSubjectDefinitions": "listDefinitions",
  "catalog.listDefinitions": "listDefinitions",
  "catalog.getDefinition": "getDefinitionById",
  "catalog.listDefinitionRevisions": "listDefinitionRevisions",
  "catalog.getDefinitionRevision": "getDefinitionRevision",
  "catalog.listDefinitionTimeline": "listDefinitionTimelineFacts"
} as const;

export const parameterCatalogClientMethodByRouteId = {
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
} as const satisfies Record<ParameterCatalogCanonicalRouteId, string>;

export const parameterCatalogProjectBindingRouteIds = [
  "parameterTopology.listBindings",
  "parameterTopology.getBindingHistory",
  "parameterTopology.getBindingCompare",
  "parameterTopology.createBindingDraft",
  "parameterTopology.createNodeEnablementDraft"
] as const;

export const parameterCatalogBoundedLegacyReadRouteIds = [
  "parameterSpecs.list",
  "parameterSpecs.get",
  "parameterSpecs.listReviewTasks",
  "parameterTopology.listIdentityMappingTasks",
  "parameterModules.getRegistry",
  "parameterModules.discoveryHints",
  "parameterModules.listDriverRegistry"
] as const;

export const parameterCatalogLegacyWriteRouteIds = [
  "parameterSpecs.create",
  "parameterSpecs.update",
  "parameterSpecs.activate",
  "parameterSpecs.deprecate",
  "parameterSpecs.restore",
  "parameterSpecs.reattribute",
  "parameterSpecs.renamePropertyKey",
  "parameterSpecs.getCutover",
  "parameterSpecs.prepareCutover",
  "parameterSpecs.finalizeCutover",
  "parameterSpecs.resolveReviewTask",
  "parameterSpecs.getPropertyKeyCutover",
  "parameterSpecs.previewPropertyKeyCutover",
  "parameterSpecs.startPropertyKeyCutover",
  "parameterSpecs.preparePropertyKeyCutover",
  "parameterSpecs.finalizePropertyKeyCutover",
  "parameterSpecs.listOrganizationDriverSchemas",
  "parameterSpecs.getOrganizationDriverSchema",
  "parameterSpecs.createOrganizationDriverSchema",
  "parameterSpecs.updateOrganizationDriverSchema",
  "parameterSpecs.activateOrganizationDriverSchema",
  "parameterSpecs.previewOrganizationDriverSchemaDeprecation",
  "parameterSpecs.deprecateOrganizationDriverSchema",
  "parameterSpecs.listPromotionCandidates",
  "parameterSpecs.promoteDriverSchemaOverlay",
  "parameterSpecs.revertDriverSchemaPromotion",
  "parameterTopology.resolveIdentityMappingTask",
  "parameterTopology.reopenIdentityMappingTask",
  "parameterModules.dismissCompatible",
  "parameterModules.restoreCompatible",
  "parameterModules.previewMapping",
  "parameterModules.createMapping",
  "parameterModules.deleteMapping",
  "parameterModules.recomputeBindings",
  "parameterModules.registerDriver",
  "parameterModules.updateDriverRegistration",
  "parameterModules.updateDriverRegistrationDefault",
  "parameterModules.replayDriverPlacement"
] as const;

export const parameterCatalogCoveredRouteIds = [
  ...parameterCatalogCanonicalRoutes.map((route) => route.id),
  ...parameterCatalogProjectBindingRouteIds,
  ...parameterCatalogLegacyWriteRouteIds
] as const;

const catalogReadErrors = {
  "401": "ErrorResponse",
  "403": "ErrorResponse",
  "404": "ErrorResponse",
  "503": "ErrorResponse"
} as const;

const catalogWriteErrors = {
  "401": "ErrorResponse",
  "403": "ErrorResponse",
  "404": "ErrorResponse",
  "409": "ErrorResponse",
  "503": "ErrorResponse"
} as const;

export const parameterCatalogSchemaRegistry = {
  "catalog.get": {
    summary: "Get the current catalog readiness document",
    tags: ["catalog"],
    responseBody: "CatalogDocumentResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [
      catalogReleaseResponseHeader,
      { name: CATALOG_RETRY_AFTER_HEADER, required: false, description: "Honor on catalog-not-ready." }
    ]
  },
  "catalog.listSubjects": {
    summary: "List catalog subjects in the current or pinned release",
    tags: ["catalog"],
    responseBody: "CatalogSubjectListResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: [
      {
        name: "type",
        in: "query",
        schema: { type: "string", enum: [...catalogSubjectKinds] }
      },
      {
        name: "lifecycle",
        in: "query",
        schema: { type: "string", enum: [...subjectLifecycles] }
      },
      { name: "registration", in: "query" },
      { name: "search", in: "query" },
      ...pageQueryParameters
    ],
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.getSubject": {
    summary: "Get one catalog subject with registration projection",
    tags: ["catalog"],
    responseBody: "CatalogSubjectResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.listSubjectDefinitions": {
    summary: "List current-release definitions for one subject",
    tags: ["catalog"],
    responseBody: "CatalogDefinitionListResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: pageQueryParameters,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.listDefinitions": {
    summary: "List current catalog definitions",
    tags: ["catalog"],
    responseBody: "CatalogDefinitionListResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: [
      { name: "subjectId", in: "query" },
      { name: "propertyKey", in: "query" },
      {
        name: "lifecycle",
        in: "query",
        schema: { type: "string", enum: [...definitionLifecycles] }
      },
      { name: "search", in: "query" },
      ...pageQueryParameters
    ],
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.getDefinition": {
    summary: "Get one catalog definition and its selected revision",
    tags: ["catalog"],
    responseBody: "CatalogDefinitionResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.listDefinitionRevisions": {
    summary: "List immutable definition revisions in reverse chronological order",
    tags: ["catalog"],
    responseBody: "CatalogDefinitionRevisionListResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: pageQueryParameters,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.getDefinitionRevision": {
    summary: "Get an exact definition revision without current/latest fallback",
    tags: ["catalog"],
    responseBody: "CatalogDefinitionRevisionResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.listDefinitionTimeline": {
    summary: "List composed definition timeline facts for the caller",
    tags: ["catalog"],
    responseBody: "CatalogDefinitionTimelineResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: pageQueryParameters,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.listRegistrations": {
    summary: "List organization subject registrations",
    tags: ["catalog"],
    responseBody: "CatalogRegistrationListResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: pageQueryParameters,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.createRegistration": {
    summary: "Register one active current-release subject with an explicit placement intent",
    tags: ["catalog"],
    requestBody: "CatalogRegisterSubjectRequest",
    responseBody: "CatalogRegistrationResponse",
    successStatus: 201,
    additionalResponses: catalogWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.getRegistration": {
    summary: "Get one organization subject registration",
    tags: ["catalog"],
    responseBody: "CatalogRegistrationResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.retireRegistration": {
    summary: "Retire a subject registration while retaining placement and history",
    tags: ["catalog"],
    requestBody: "CatalogRetireRegistrationRequest",
    responseBody: "CatalogRegistrationResponse",
    additionalResponses: catalogWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.restoreRegistration": {
    summary: "Restore a retired subject registration onto its retained placement",
    tags: ["catalog"],
    requestBody: "CatalogRestoreRegistrationRequest",
    responseBody: "CatalogRegistrationResponse",
    additionalResponses: catalogWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.getPlacement": {
    summary: "Get the retained placement for a subject registration",
    tags: ["catalog"],
    responseBody: "CatalogPlacementResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.updatePlacement": {
    summary: "Rename or reparent the retained placement using If-Match",
    tags: ["catalog"],
    requestBody: "CatalogUpdatePlacementRequest",
    responseBody: "CatalogPlacementResponse",
    additionalResponses: catalogWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.listObservations": {
    summary: "List organization parameter observations",
    tags: ["catalog"],
    responseBody: "CatalogObservationListResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: pageQueryParameters,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.getObservation": {
    summary: "Get one parameter observation",
    tags: ["catalog"],
    responseBody: "CatalogObservationResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.listReviewItems": {
    summary: "List the organization parameter review queue",
    tags: ["catalog"],
    responseBody: "CatalogReviewItemListResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: pageQueryParameters,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.getReviewItem": {
    summary: "Get one review item with allowed resolutions",
    tags: ["catalog"],
    responseBody: "CatalogReviewItemResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.resolveReviewItem": {
    summary: "Resolve one review item with an explicit placement or closed outcome",
    tags: ["catalog"],
    requestBody: "CatalogResolveReviewItemRequest",
    responseBody: "CatalogReviewResolutionResponse",
    additionalResponses: catalogWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.listProposals": {
    summary: "List role-scoped definition proposals",
    tags: ["catalog"],
    responseBody: "CatalogProposalListResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: pageQueryParameters,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.createProposal": {
    summary: "Create an organization-authored definition proposal draft",
    tags: ["catalog"],
    requestBody: "CatalogCreateProposalRequest",
    responseBody: "CatalogProposalResponse",
    successStatus: 201,
    additionalResponses: catalogWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.getProposal": {
    summary: "Get one definition proposal",
    tags: ["catalog"],
    responseBody: "CatalogProposalResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.submitProposal": {
    summary: "Submit a definition proposal for platform review",
    tags: ["catalog"],
    requestBody: "CatalogSubmitProposalRequest",
    responseBody: "CatalogProposalResponse",
    additionalResponses: catalogWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.withdrawProposal": {
    summary: "Withdraw a definition proposal",
    tags: ["catalog"],
    requestBody: "CatalogWithdrawProposalRequest",
    responseBody: "CatalogProposalResponse",
    additionalResponses: catalogWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.acceptProposal": {
    summary: "Accept a definition proposal as publication intent",
    tags: ["catalog"],
    requestBody: "CatalogAcceptProposalRequest",
    responseBody: "CatalogProposalResponse",
    additionalResponses: catalogWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.rejectProposal": {
    summary: "Reject a definition proposal",
    tags: ["catalog"],
    requestBody: "CatalogRejectProposalRequest",
    responseBody: "CatalogProposalResponse",
    additionalResponses: catalogWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.getLegacyIdentifier": {
    summary: "Look up an exact authorized legacy identifier mapping",
    tags: ["catalog"],
    responseBody: "CatalogLegacyIdentifierResponse",
    additionalResponses: {
      "401": "ErrorResponse",
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse",
      "410": "ErrorResponse"
    },
    successHeaders: [
      catalogReleaseResponseHeader,
      { name: CATALOG_DEPRECATION_HEADER, required: true },
      { name: CATALOG_SUNSET_HEADER, required: true },
      { name: CATALOG_LINK_HEADER, required: true },
      { name: CATALOG_WARNING_HEADER, required: true },
      { name: CATALOG_LEGACY_CONTRACT_HEADER, required: true }
    ]
  }
} as const;
