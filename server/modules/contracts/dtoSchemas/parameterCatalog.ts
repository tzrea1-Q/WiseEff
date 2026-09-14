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
  "PCAT-API-12",
  "PCAT-API-13"
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
  "proposal-replay-unavailable",
  "proposal-self-approval-forbidden",
  "revision-conflict",
  "legacy-id-archived",
  "legacy-surface-retired",
  "legacy-id-ambiguous",
  "forbidden",
  "migration-diagnostics-not-public",
  "publication-not-authorized",
  "publication-capability-missing",
  "publication-self-approval-forbidden",
  "publication-policy-disabled",
  "publication-frozen",
  "candidate-stale",
  "candidate-tampered",
  "needs-rebase",
  "unsupported-catalog-capability",
  "publication-authorization-revoked",
  "idempotency-key-conflict",
  "artifact-missing",
  "predecessor-incomplete",
  "activation-receipt-mismatch",
  "adoption-evidence-invalid",
  "catalog-not-adopted",
  "registration-followup-failed"
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
  "proposal-replay-unavailable": "inspect-proposal-no-retry",
  "proposal-self-approval-forbidden": "require-other-platform-admin",
  "revision-conflict": "refresh-no-silent-retry",
  "legacy-id-archived": "historical-unavailable",
  "legacy-surface-retired": "migrate-to-successor-no-retry",
  "legacy-id-ambiguous": "no-candidate-disclosure",
  forbidden: "hide-out-of-scope",
  "migration-diagnostics-not-public": "treat-as-not-found",
  "publication-not-authorized": "require-catalog-publish-capability",
  "publication-capability-missing": "require-catalog-capability",
  "publication-self-approval-forbidden": "require-other-publisher",
  "publication-policy-disabled": "publication-disabled",
  "publication-frozen": "wait-unfreeze-no-retry",
  "candidate-stale": "rebuild-candidate",
  "candidate-tampered": "rebuild-candidate",
  "needs-rebase": "rebase-candidate",
  "unsupported-catalog-capability": "remove-unsupported-change",
  "publication-authorization-revoked": "reauthorize-no-busy-retry",
  "idempotency-key-conflict": "new-idempotency-key",
  "artifact-missing": "restore-predecessor-artifact",
  "predecessor-incomplete": "rebuild-complete-successor",
  "activation-receipt-mismatch": "inspect-receipt-no-retry",
  "adoption-evidence-invalid": "inspect-adoption-evidence",
  "catalog-not-adopted": "inspect-adoption-evidence",
  "registration-followup-failed": "retry-registration-keep-catalog"
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
    /**
     * Truthful scoped count for the filtered query, before paging. A missing
     * count is an unavailable state for the UI, never a zero result.
     */
    totalCount: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    /** Resolved organization module name when a module subtree filter applied. */
    placementModuleName: z.string().optional(),
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
  parentPlacementId: z.string().nullable(),
  /**
   * Organization module the placement points at, so a module-subtree collection
   * filter can name the module rather than the retained placement. Optional so
   * a projection that cannot name the module stays valid; the read surface then
   * falls back to the placement identity rather than inventing a module.
   */
  moduleId: z.string().optional()
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
  aliases: z.array(z.string()),
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
  /** Editable display name; empty string means the author left it unset. */
  displayName: z.string(),
  valueShape: catalogValueShapeSchema,
  constraints: catalogConstraintsSchema,
  documentation: z.string().nullable(),
  /** Symbol unit descriptor, absent when the definition declares no unit. */
  unit: catalogObject({ kind: z.literal("symbol"), symbol: z.string() }).nullable(),
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
  /**
   * Creation time, present on list projections. A command result reports the
   * proposal it just wrote and omits it; the list is ordered newest first by it
   * whenever it is present.
   */
  createdAt: z.string().optional(),
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

export const catalogPublicationReferenceSchema = z.union([
  catalogObject({
    kind: z.literal("repository"),
    repositoryReference: z.string()
  }),
  catalogObject({
    kind: z.literal("candidate"),
    candidateId: z.string()
  })
]);

export const catalogAcceptProposalRequestSchema = catalogObject({
  repositoryReference: z.string().optional(),
  publicationReference: catalogPublicationReferenceSchema.optional()
}).superRefine((value, ctx) => {
  if (value.publicationReference?.kind === "candidate") {
    if (value.repositoryReference !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repositoryReference"],
        message: "candidate reference must not include repositoryReference"
      });
    }
    return;
  }
  if (value.publicationReference?.kind === "repository") {
    return;
  }
  if (value.repositoryReference === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["repositoryReference"],
      message: "repositoryReference"
    });
  }
});

export const catalogRejectProposalRequestSchema = catalogObject({
  reason: z.string()
});

export const catalogPublicationJobStatuses = [
  "queued",
  "running",
  "active",
  "needs-rebase",
  "blocked",
  "failed-retryable",
  "failed-terminal",
  "cancelled"
] as const;

export const catalogPublicationRiskClasses = ["low", "high"] as const;

export const catalogPublicationCurrentness = ["active", "active-superseded"] as const;

export const catalogSupportedValueSchemaSchema = z.union([
  catalogObject({
    type: z.literal("integer"),
    minimum: z.number().optional(),
    maximum: z.number().optional()
  }),
  catalogObject({
    type: z.literal("number"),
    minimum: z.number().optional(),
    maximum: z.number().optional()
  }),
  catalogObject({
    type: z.literal("string")
  }),
  catalogObject({
    type: z.literal("boolean")
  }),
  catalogObject({
    type: z.literal("null")
  }),
  catalogObject({
    type: z.literal("array"),
    items: z
      .union([
        catalogObject({ type: z.literal("string") }),
        catalogObject({
          type: z.literal("integer"),
          minimum: z.number().optional(),
          maximum: z.number().optional()
        })
      ])
      .optional()
  }),
  catalogObject({
    description: z.string().min(1)
  })
]);

export const catalogSupportedDefinitionContentSchema = catalogObject({
  displayName: z.string(),
  documentation: z.string(),
  /** Optional author description, distinct from long-form documentation. */
  description: z.string().max(512).optional(),
  unit: z.string().min(1).max(32).optional(),
  valueSchema: catalogSupportedValueSchemaSchema,
  examples: z
    .array(
      z.union([
        z.number(),
        z.string(),
        z.boolean(),
        z.null(),
        z.array(z.union([z.number(), z.string(), z.boolean()]))
      ])
    )
    .optional()
});

export const catalogNestedDefinitionDraftSchema = catalogObject({
  propertyKey: z.string(),
  content: catalogSupportedDefinitionContentSchema
});

export const catalogCreateSubjectWithDefinitionsChangeSchema = catalogObject({
  op: z.literal("create-subject-with-definitions"),
  kind: z.enum(["driver", "node-type"]),
  canonicalKey: z.string(),
  selector: catalogObject({
    kind: z.enum(["driver-compatible", "node-type-name"]),
    value: z.string()
  }),
  nature: z.enum(["physical-device", "logical-service"]).optional(),
  cardinality: z.enum(["multiple", "singleton-per-project"]).optional(),
  definitions: z.array(catalogNestedDefinitionDraftSchema).min(1).max(32)
});

export const catalogReviseDefinitionChangeSchema = catalogObject({
  op: z.literal("revise-definition"),
  definitionId: z.string(),
  class: z.enum(["documentation", "semantic"]),
  content: catalogSupportedDefinitionContentSchema
});

export const catalogCreateDefinitionChangeSchema = catalogObject({
  op: z.literal("create-definition"),
  subjectId: z.string(),
  propertyKey: z.string(),
  /**
   * Lifecycle intent for a newly minted definition. `retired` is rejected by the
   * builder; the field exists so a create and a restore share one contract.
   */
  lifecycle: z.enum(["active"]).optional(),
  content: catalogSupportedDefinitionContentSchema
});

/**
 * Reversible definition lifecycle. Decision 10 of #847 maps the historical
 * deprecate action to canonical soft retirement: `retire-definition` publishes
 * `retired` for the same identity and key, and `restore-definition` publishes
 * `active` for the same identity and key. Neither rewrites history or the
 * permanent identity, and `deprecated` stays a distinct existing state.
 */
export const catalogRetireDefinitionChangeSchema = catalogObject({
  op: z.literal("retire-definition"),
  definitionId: z.string(),
  class: z.enum(["documentation", "semantic"]).optional(),
  reason: z.string().min(1).max(512).optional(),
  content: catalogSupportedDefinitionContentSchema
});

export const catalogRestoreDefinitionChangeSchema = catalogObject({
  op: z.literal("restore-definition"),
  definitionId: z.string(),
  class: z.enum(["documentation", "semantic"]).optional(),
  reason: z.string().min(1).max(512).optional(),
  content: catalogSupportedDefinitionContentSchema
});

export const catalogChangeSchema = z.union([
  catalogCreateDefinitionChangeSchema,
  catalogCreateSubjectWithDefinitionsChangeSchema,
  catalogReviseDefinitionChangeSchema,
  catalogRetireDefinitionChangeSchema,
  catalogRestoreDefinitionChangeSchema
]);

export const catalogCreatePublicationCandidateRequestSchema = catalogObject({
  changeSet: z.array(catalogChangeSchema).min(1).max(32),
  proposalId: z.string().optional(),
  proposalRevisionId: z.string().optional()
});

export const catalogPublishPublicationCandidateRequestSchema = catalogObject({
  idempotencyKey: z.string().min(1)
});

export const catalogPublicationImpactSummaryDtoSchema = catalogObject({
  addedDefinitionCount: z.number().int().nonnegative(),
  changedDefinitionCount: z.number().int().nonnegative(),
  addedSubjectCount: z.number().int().nonnegative(),
  addedSubjectIds: z.array(z.string()).optional()
});

export const catalogPublicationCapabilityContractDtoSchema = catalogObject({
  revision: z.string(),
  allowListId: z.string()
});

export const catalogPublicationCandidateDtoSchema = catalogObject({
  id: z.string(),
  expectedBaseReleaseId: z.string(),
  expectedBaseReleaseDigest: z.string(),
  riskClass: closedEnum(catalogPublicationRiskClasses),
  impactSummary: catalogPublicationImpactSummaryDtoSchema,
  capabilityContract: catalogPublicationCapabilityContractDtoSchema
});

export const catalogPublicationFailureDtoSchema = catalogObject({
  class: z.string(),
  reason: catalogApiFailureReasonSchema
});

export const catalogPublicationJobDtoSchema = catalogObject({
  id: z.string(),
  candidateId: z.string(),
  status: closedEnum(catalogPublicationJobStatuses),
  attemptCount: z.number().int().nonnegative(),
  effective: z.boolean(),
  isCurrent: z.boolean(),
  currentness: closedEnum(catalogPublicationCurrentness).nullable(),
  failure: catalogPublicationFailureDtoSchema.nullable(),
  createdAt: z.string().optional(),
  sourceKind: z.string().optional()
});

export const catalogPublicationBlockerSchema = closedEnum([
  "publication-policy-disabled",
  "publication-frozen",
  "catalog-not-adopted",
  "publication-capability-missing",
  "publication-not-authorized"
] as const);

export const catalogPublicationSurfaceDtoSchema = catalogObject({
  publicationEnabled: z.boolean(),
  lowRiskSingleActorPublish: z.boolean(),
  policyRevision: z.number().int(),
  frozen: z.boolean(),
  adopted: z.boolean(),
  currentReleaseId: z.string().nullable(),
  authoringAllowed: z.boolean(),
  publishingAllowed: z.boolean(),
  reviewHighRiskAllowed: z.boolean(),
  blockers: z.array(catalogPublicationBlockerSchema)
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

export const catalogDocumentResponseSchema = z.union([
  itemEnvelopeSchema(catalogDocumentDtoSchema),
  catalogObject({ item: z.null(), publicationState: z.literal("unpublished") }),
]).superRefine(rejectLegacySpecKeys);
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
export const catalogPublicationCandidateResponseSchema = itemEnvelopeSchema(
  catalogPublicationCandidateDtoSchema
).superRefine(rejectLegacySpecKeys);
export const catalogPublicationJobResponseSchema = itemEnvelopeSchema(
  catalogPublicationJobDtoSchema
).superRefine(rejectLegacySpecKeys);
export const catalogPublicationJobListResponseSchema = catalogItemsEnvelopeSchema(
  catalogPublicationJobDtoSchema
);
export const catalogPublicationSurfaceResponseSchema = itemEnvelopeSchema(
  catalogPublicationSurfaceDtoSchema
).superRefine(rejectLegacySpecKeys);
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

export const catalogProposalUnavailableResponseSchema = z.object({
  error: z.object({
    code: z.literal("SERVICE_UNAVAILABLE"),
    message: z.string(),
    requestId: z.string(),
    details: z.union([
      z.object({ reason: z.literal("catalog-not-ready"), retryable: z.literal(true) }).passthrough(),
      z.object({ reason: z.literal("proposal-replay-unavailable"), retryable: z.literal(false) }).passthrough()
    ])
  })
});

// ---------------------------------------------------------------------------
// Definition identity correction migration (#847 decisions 12-17, S2).
// One high-level governance contract: preview, create, read, continue, list.
// It coordinates the existing authoring/publication/binding/value/audit
// capabilities and never authors Catalog truth directly.
// ---------------------------------------------------------------------------

export const catalogReplacementStatusSchema = z.enum([
  "pending",
  "executing",
  "completed",
  "blocked",
  "failed"
]);

export const catalogReplacementProjectStatusSchema = z.enum([
  "completed",
  "blocked",
  "failed",
  "pending"
]);

export const catalogReplacementIdentitySchema = catalogObject({
  definitionId: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  propertyKey: z.string(),
  revisionId: z.string()
});

export const catalogReplacementProjectDtoSchema = catalogObject({
  projectId: z.string(),
  projectName: z.string(),
  status: catalogReplacementProjectStatusSchema,
  blockerReason: z.string().nullable(),
  oldBindingId: z.string(),
  oldValueId: z.string(),
  newBindingId: z.string().nullable(),
  newValueId: z.string().nullable(),
  valueKind: z.string(),
  compatible: z.boolean(),
  attemptCount: z.number().int().nonnegative(),
  registrationRequired: z.boolean()
});

export const catalogReplacementPreviewRequestSchema = catalogObject({
  oldDefinitionId: z.string(),
  newSubjectId: z.string(),
  newPropertyKey: z.string(),
  displayName: z.string(),
  documentation: z.string(),
  description: z.string().max(512).optional(),
  unit: z.string().min(1).max(32).optional(),
  valueSchema: catalogSupportedValueSchemaSchema,
  examples: z
    .array(
      z.union([
        z.number(),
        z.string(),
        z.boolean(),
        z.null(),
        z.array(z.union([z.number(), z.string(), z.boolean()]))
      ])
    )
    .optional(),
  projectIds: z.array(z.string()).min(1).max(200),
  reason: z.string().min(1).max(512)
});

export const catalogCreateReplacementRequestSchema = catalogObject({
  previewId: z.string(),
  previewFingerprint: z.string(),
  idempotencyKey: z.string().min(1),
  confirmationNote: z.string().max(512).optional()
});

export const catalogContinueReplacementRequestSchema = catalogObject({
  idempotencyKey: z.string().min(1),
  projectIds: z.array(z.string()).min(1).max(200).optional(),
  reason: z.string().max(512).optional()
});

export const catalogReplacementDtoSchema = catalogObject({
  id: z.string(),
  status: catalogReplacementStatusSchema,
  organizationId: z.string(),
  oldIdentity: catalogReplacementIdentitySchema,
  newIdentity: catalogReplacementIdentitySchema,
  previewFingerprint: z.string(),
  catalogReleaseId: z.string(),
  candidateId: z.string().nullable(),
  publicationJobId: z.string().nullable(),
  authorizationId: z.string().nullable(),
  reason: z.string(),
  etag: z.string(),
  version: z.number().int().positive(),
  projects: z.array(catalogReplacementProjectDtoSchema),
  createdAt: z.string()
});

export const catalogReplacementPreviewDtoSchema = catalogObject({
  previewId: z.string(),
  previewFingerprint: z.string(),
  organizationId: z.string(),
  oldIdentity: catalogReplacementIdentitySchema,
  newIdentity: catalogReplacementIdentitySchema,
  catalogReleaseId: z.string(),
  impact: catalogObject({
    selectedProjectCount: z.number().int().nonnegative(),
    compatibleProjectCount: z.number().int().nonnegative(),
    blockedProjectCount: z.number().int().nonnegative(),
    coupledDefinitionCount: z.number().int().nonnegative(),
    sourceFormatSupported: z.boolean(),
    oldDefinitionLifecycle: catalogDefinitionLifecycleSchema,
    oldDefinitionCurrentReferenceCount: z.number().int().nonnegative(),
    targetRegistrationRequired: z.boolean()
  }),
  blockers: z.array(z.string()),
  projects: z.array(catalogReplacementProjectDtoSchema),
  expiresAt: z.string().nullable()
});

export const catalogReplacementResponseSchema = itemEnvelopeSchema(
  catalogReplacementDtoSchema
).superRefine(rejectLegacySpecKeys);
export const catalogReplacementPreviewResponseSchema = itemEnvelopeSchema(
  catalogReplacementPreviewDtoSchema
).superRefine(rejectLegacySpecKeys);
export const catalogReplacementListResponseSchema = catalogItemsEnvelopeSchema(
  catalogReplacementDtoSchema
);


export const parameterCatalogDtoSchemaCatalog = {
  CatalogProposalUnavailableResponse: catalogProposalUnavailableResponseSchema,
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
  CatalogCreatePublicationCandidateRequest: catalogCreatePublicationCandidateRequestSchema,
  CatalogPublicationCandidateResponse: catalogPublicationCandidateResponseSchema,
  CatalogPublishPublicationCandidateRequest: catalogPublishPublicationCandidateRequestSchema,
  CatalogPublicationJobResponse: catalogPublicationJobResponseSchema,
  CatalogPublicationJobListResponse: catalogPublicationJobListResponseSchema,
  CatalogPublicationSurfaceResponse: catalogPublicationSurfaceResponseSchema,
  CatalogReplacementStatus: catalogReplacementStatusSchema,
  CatalogReplacementProjectStatus: catalogReplacementProjectStatusSchema,
  CatalogReplacementIdentity: catalogReplacementIdentitySchema,
  CatalogReplacementProject: catalogReplacementProjectDtoSchema,
  CatalogReplacement: catalogReplacementDtoSchema,
  CatalogReplacementPreview: catalogReplacementPreviewDtoSchema,
  CatalogReplacementPreviewRequest: catalogReplacementPreviewRequestSchema,
  CatalogCreateReplacementRequest: catalogCreateReplacementRequestSchema,
  CatalogContinueReplacementRequest: catalogContinueReplacementRequestSchema,
  CatalogReplacementResponse: catalogReplacementResponseSchema,
  CatalogReplacementPreviewResponse: catalogReplacementPreviewResponseSchema,
  CatalogReplacementListResponse: catalogReplacementListResponseSchema,
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
    id: "catalog.createPublicationCandidate",
    method: "POST",
    path: "/api/v2/catalog/publication-candidates",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getPublicationCandidate",
    method: "GET",
    path: "/api/v2/catalog/publication-candidates/:candidateId",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.publishPublicationCandidate",
    method: "POST",
    path: "/api/v2/catalog/publication-candidates/:candidateId/publish",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getPublicationSurface",
    method: "GET",
    path: "/api/v2/catalog/publication-surface",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.listPublications",
    method: "GET",
    path: "/api/v2/catalog/publications",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getPublication",
    method: "GET",
    path: "/api/v2/catalog/publications/:jobId",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getLegacyIdentifier",
    method: "GET",
    path: "/api/v2/catalog/legacy-identifiers/:legacyType/:legacyId",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.previewDefinitionReplacement",
    method: "POST",
    path: "/api/v2/catalog/definition-replacements/preview",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.listDefinitionReplacements",
    method: "GET",
    path: "/api/v2/catalog/definition-replacements",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.createDefinitionReplacement",
    method: "POST",
    path: "/api/v2/catalog/definition-replacements",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.getDefinitionReplacement",
    method: "GET",
    path: "/api/v2/catalog/definition-replacements/:replacementId",
    module: "catalog",
    stability: "mvp"
  },
  {
    id: "catalog.continueDefinitionReplacement",
    method: "POST",
    path: "/api/v2/catalog/definition-replacements/:replacementId/continue",
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
  "catalog.createPublicationCandidate": ["PCAT-API-10", "PCAT-API-11"],
  "catalog.getPublicationCandidate": ["PCAT-API-11"],
  "catalog.publishPublicationCandidate": ["PCAT-API-10", "PCAT-API-11"],
  "catalog.getPublicationSurface": ["PCAT-API-11"],
  "catalog.listPublications": ["PCAT-API-11"],
  "catalog.getPublication": ["PCAT-API-11"],
  "catalog.previewDefinitionReplacement": ["PCAT-API-13"],
  "catalog.listDefinitionReplacements": ["PCAT-API-13"],
  "catalog.createDefinitionReplacement": ["PCAT-API-13"],
  "catalog.getDefinitionReplacement": ["PCAT-API-13"],
  "catalog.continueDefinitionReplacement": ["PCAT-API-13"],
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
  "catalog.createPublicationCandidate": "createPublicationCandidate",
  "catalog.getPublicationCandidate": "getPublicationCandidate",
  "catalog.publishPublicationCandidate": "publishPublicationCandidate",
  "catalog.getPublicationSurface": "getPublicationSurface",
  "catalog.listPublications": "listPublications",
  "catalog.getPublication": "getPublication",
  "catalog.getLegacyIdentifier": "getLegacyIdentifier",
  "catalog.previewDefinitionReplacement": "previewDefinitionReplacement",
  "catalog.listDefinitionReplacements": "listDefinitionReplacements",
  "catalog.createDefinitionReplacement": "createDefinitionReplacement",
  "catalog.getDefinitionReplacement": "getDefinitionReplacement",
  "catalog.continueDefinitionReplacement": "continueDefinitionReplacement"
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

const catalogPublicationWriteErrors = {
  ...catalogWriteErrors,
  "400": "ErrorResponse",
  "422": "ErrorResponse"
} as const;

const proposalWriteErrors = { ...catalogWriteErrors, "503": "CatalogProposalUnavailableResponse" } as const;

export const parameterCatalogSchemaRegistry = {
  "catalog.previewDefinitionReplacement": {
    summary:
      "Preview a definition identity correction: exact impact, compatibility, project manifest and blockers",
    tags: ["catalog"],
    requestBody: "CatalogReplacementPreviewRequest",
    responseBody: "CatalogReplacementPreviewResponse",
    additionalResponses: catalogWriteErrors,
    successHeaders: [catalogReleaseResponseHeader],
    requiresCatalogReleaseHeader: true
  },
  "catalog.listDefinitionReplacements": {
    summary: "List definition replacements owned by the caller's organization",
    tags: ["catalog"],
    responseBody: "CatalogReplacementListResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: [{ name: "catalogReleaseId", in: "query" }],
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.createDefinitionReplacement": {
    summary:
      "Execute an approved replacement: publish the replacement identity then migrate the selected projects",
    tags: ["catalog"],
    requestBody: "CatalogCreateReplacementRequest",
    responseBody: "CatalogReplacementResponse",
    additionalResponses: catalogWriteErrors,
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader],
    requiresCatalogReleaseHeader: true,
    requiresIdempotencyKeyHeader: true
  },
  "catalog.getDefinitionReplacement": {
    summary: "Read one definition replacement with its per-project progress",
    tags: ["catalog"],
    responseBody: "CatalogReplacementResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.continueDefinitionReplacement": {
    summary: "Continue blocked projects of an approved replacement",
    tags: ["catalog"],
    requestBody: "CatalogContinueReplacementRequest",
    responseBody: "CatalogReplacementResponse",
    additionalResponses: catalogWriteErrors,
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader],
    requiresCatalogReleaseHeader: true,
    requiresIfMatchHeader: true,
    requiresIdempotencyKeyHeader: true
  },
  "catalog.get": {
    summary: "Get the current catalog readiness document",
    tags: ["catalog"],
    responseBody: "CatalogDocumentResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: [{ name: "catalogReleaseId", in: "query" }],
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.listSubjects": {
    summary: "List catalog subjects in the current or pinned release",
    tags: ["catalog"],
    responseBody: "CatalogSubjectListResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: [
      { name: "catalogReleaseId", in: "query" },
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
      {
        name: "placementModuleId",
        in: "query",
        schema: { type: "string" },
        description:
          "Organization module id; selects subjects placed at or below the module subtree before pagination."
      },
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
      { name: "catalogReleaseId", in: "query" },
      { name: "subjectId", in: "query" },
      {
        name: "subjectIds",
        in: "query",
        schema: { type: "array", items: { type: "string" } },
        description:
          "Explicit trusted multi-subject scope, applied before pagination. Repeated query parameter."
      },
      {
        name: "placementModuleId",
        in: "query",
        schema: { type: "string" },
        description:
          "Organization module id; selects definitions of subjects placed at or below the module subtree before pagination."
      },
      { name: "propertyKey", in: "query" },
      { name: "registration", in: "query" },
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
    additionalResponses: proposalWriteErrors,
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
    additionalResponses: proposalWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.withdrawProposal": {
    summary: "Withdraw a definition proposal",
    tags: ["catalog"],
    requestBody: "CatalogWithdrawProposalRequest",
    responseBody: "CatalogProposalResponse",
    additionalResponses: proposalWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.acceptProposal": {
    summary: "Accept a definition proposal as publication intent",
    tags: ["catalog"],
    requestBody: "CatalogAcceptProposalRequest",
    responseBody: "CatalogProposalResponse",
    additionalResponses: proposalWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.rejectProposal": {
    summary: "Reject a definition proposal",
    tags: ["catalog"],
    requestBody: "CatalogRejectProposalRequest",
    responseBody: "CatalogProposalResponse",
    additionalResponses: proposalWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader, catalogIfMatchHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.createPublicationCandidate": {
    summary: "Build and freeze a complete successor publication candidate from a typed ChangeSet",
    tags: ["catalog"],
    requestBody: "CatalogCreatePublicationCandidateRequest",
    responseBody: "CatalogPublicationCandidateResponse",
    successStatus: 201,
    additionalResponses: catalogPublicationWriteErrors,
    requestParameters: [catalogReleaseRequestHeader],
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.getPublicationCandidate": {
    summary: "Get one frozen publication candidate in the caller scope",
    tags: ["catalog"],
    responseBody: "CatalogPublicationCandidateResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.publishPublicationCandidate": {
    summary: "Authorize and enqueue publication of a frozen candidate; returns a job, not a definition",
    tags: ["catalog"],
    requestBody: "CatalogPublishPublicationCandidateRequest",
    responseBody: "CatalogPublicationJobResponse",
    successStatus: 201,
    additionalResponses: catalogPublicationWriteErrors,
    requestParameters: [catalogReleaseRequestHeader],
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.getPublicationSurface": {
    summary: "Read instance publication policy, adoption, freeze, and session-capable actions",
    tags: ["catalog"],
    responseBody: "CatalogPublicationSurfaceResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.listPublications": {
    summary: "List publication jobs visible in the caller organization",
    tags: ["catalog"],
    responseBody: "CatalogPublicationJobListResponse",
    additionalResponses: catalogReadErrors,
    requestParameters: pageQueryParameters,
    successHeaders: [catalogReleaseResponseHeader]
  },
  "catalog.getPublication": {
    summary: "Get one publication job, including verified Receipt effectiveness and currentness",
    tags: ["catalog"],
    responseBody: "CatalogPublicationJobResponse",
    additionalResponses: catalogReadErrors,
    successHeaders: [catalogReleaseResponseHeader]
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
  },
  "catalog.retireDefinition": {
    summary: "Soft-retire one canonical definition identity in one publication",
    tags: ["catalog"],
    requestBody: "CatalogDefinitionLifecycleChangeRequest",
    responseBody: "CatalogDefinitionLifecycleChangeResponse",
    successStatus: 201,
    additionalResponses: catalogPublicationWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  },
  "catalog.restoreDefinition": {
    summary: "Restore a soft-retired canonical definition identity to active",
    tags: ["catalog"],
    requestBody: "CatalogDefinitionLifecycleChangeRequest",
    responseBody: "CatalogDefinitionLifecycleChangeResponse",
    successStatus: 201,
    additionalResponses: catalogPublicationWriteErrors,
    requestParameters: [catalogReleaseRequestHeader, catalogIdempotencyHeader],
    successHeaders: [catalogReleaseResponseHeader, catalogEtagResponseHeader]
  }
} as const;
