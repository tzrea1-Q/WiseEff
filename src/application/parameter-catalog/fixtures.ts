import type {
  CatalogDefinitionResponse,
  CatalogDefinitionRevisionResponse,
  CatalogDefinitionTimelineResponse,
  CatalogDocumentResponse,
  CatalogLegacyIdentifierResponse,
  CatalogObservationResponse,
  CatalogPlacementResponse,
  CatalogProposalResponse,
  CatalogRegistrationResponse,
  CatalogReviewItemResponse,
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";

export const CATALOG_RELEASE_ID = "crel_01K42";
export const CATALOG_ORGANIZATION_ID = "org_acme";
export const CATALOG_SUBJECT_ID = "csub_01KSC8562";
export const CATALOG_DEFINITION_ID = "pdef_01KGPIOINT";
export const CATALOG_REVISION_ID = "drev_01K6";
export const CATALOG_REGISTRATION_ID = "sreg_01KACME";
export const CATALOG_PLACEMENT_ID = "splc_01KROOT";
export const CATALOG_REVIEW_ITEM_ID = "prev_01KAMBIG";
export const CATALOG_PROPOSAL_ID = "pprp_01KDOC";
export const CATALOG_OBSERVATION_ID = "pobs_01KOBS";
export const CATALOG_AUTHOR_PERSON_ID = "user_author";
export const CATALOG_REVIEWER_PERSON_ID = "user_reviewer";

export const readyCatalogDocument: CatalogDocumentResponse = {
  item: {
    catalogReleaseId: CATALOG_RELEASE_ID,
    releaseName: "2026.08.3",
    releaseSequence: 42,
    publishedAt: "2026-08-31T02:00:00Z",
    materializedAt: "2026-08-31T02:01:12Z",
    status: "ready",
    digest: "sha256:abc",
    materializationFingerprint: "sha256:def",
    links: {
      subjects: "/api/v2/catalog/subjects",
      definitions: "/api/v2/catalog/definitions"
    }
  }
};

const placement = {
  id: CATALOG_PLACEMENT_ID,
  displayName: "Root",
  parentPlacementId: null
};

const revision = {
  id: CATALOG_REVISION_ID,
  definitionId: CATALOG_DEFINITION_ID,
  revisionNumber: 6,
  contentDigest: "sha256:rev",
  valueShape: { kind: "json-schema" as const, schema: { type: "integer" } },
  constraints: { kind: "none" as const },
  documentation: "GPIO interrupt",
  publishedInCatalogReleaseId: CATALOG_RELEASE_ID
};

export const unregisteredSubject: CatalogSubjectResponse["item"] = {
  id: CATALOG_SUBJECT_ID,
  type: "driver",
  canonicalName: "southchip,sc8562",
  aliases: ["sc8562"],
  membership: { status: "active", catalogReleaseId: CATALOG_RELEASE_ID },
  registration: { status: "unregistered" },
  definitionCounts: { active: 14, deprecated: 1, retired: 0 },
  availableActions: ["register"]
};

export const registeredSubject: CatalogSubjectResponse["item"] = {
  id: CATALOG_SUBJECT_ID,
  type: "driver",
  canonicalName: "southchip,sc8562",
  aliases: ["sc8562"],
  membership: { status: "active", catalogReleaseId: CATALOG_RELEASE_ID },
  registration: {
    status: "active",
    id: CATALOG_REGISTRATION_ID,
    method: "explicit",
    placement
  },
  definitionCounts: { active: 14, deprecated: 1, retired: 0 }
};

export const retiredSubject: CatalogSubjectResponse["item"] = {
  ...registeredSubject,
  membership: { status: "retired", catalogReleaseId: CATALOG_RELEASE_ID }
};

export const activeDefinition: CatalogDefinitionResponse["item"] = {
  id: CATALOG_DEFINITION_ID,
  subject: {
    id: CATALOG_SUBJECT_ID,
    type: "driver",
    canonicalName: "southchip,sc8562"
  },
  propertyKey: "gpio-int",
  lifecycle: "active",
  currentRevision: revision,
  registration: registeredSubject.registration,
  usageSummary: { policyCount: 1, projectCount: 2, currentValueCount: 2 },
  links: {
    revisions: `/api/v2/catalog/definitions/${CATALOG_DEFINITION_ID}/revisions`,
    timeline: `/api/v2/catalog/definitions/${CATALOG_DEFINITION_ID}/timeline`
  }
};

export const retiredDefinition: CatalogDefinitionResponse["item"] = {
  ...activeDefinition,
  lifecycle: "retired"
};

export const catalogRevision: CatalogDefinitionRevisionResponse["item"] = revision;

export const catalogTimeline: CatalogDefinitionTimelineResponse = {
  items: [
    {
      id: "tfact_01KGPIOINT",
      kind: "catalog-publication",
      definitionId: CATALOG_DEFINITION_ID,
      revisionId: CATALOG_REVISION_ID,
      revisionNumber: 6,
      catalogReleaseId: CATALOG_RELEASE_ID,
      publishedAt: "2026-08-31T02:00:00Z",
      changes: ["introduced"],
      summary: "Published"
    }
  ],
  nextCursor: null,
  catalogReleaseId: CATALOG_RELEASE_ID
};

export const catalogRegistration: CatalogRegistrationResponse["item"] = {
  id: CATALOG_REGISTRATION_ID,
  organizationId: CATALOG_ORGANIZATION_ID,
  subjectId: CATALOG_SUBJECT_ID,
  status: "active",
  method: "explicit",
  placement,
  catalogReleaseId: CATALOG_RELEASE_ID
};

export const catalogPlacement: CatalogPlacementResponse["item"] = placement;

export const catalogObservation: CatalogObservationResponse["item"] = {
  id: CATALOG_OBSERVATION_ID,
  organizationId: CATALOG_ORGANIZATION_ID,
  propertyKey: "gpio-int",
  sourceRef: { kind: "dts", id: "src_1" },
  recognition: "ambiguous",
  reviewItemId: CATALOG_REVIEW_ITEM_ID
};

export const catalogReviewItem: CatalogReviewItemResponse["item"] = {
  id: CATALOG_REVIEW_ITEM_ID,
  organizationId: CATALOG_ORGANIZATION_ID,
  reason: "ambiguous",
  status: "open",
  etag: "etag-1",
  catalogReleaseId: CATALOG_RELEASE_ID,
  observation: {
    id: CATALOG_OBSERVATION_ID,
    propertyKey: "gpio-int",
    sourceRef: { kind: "dts", id: "src_1" }
  },
  candidates: [{ subjectId: CATALOG_SUBJECT_ID, evidence: ["compatible"] }],
  allowedResolutions: ["register-subject"],
  candidateState: {
    status: "current",
    capturedRelease: { id: CATALOG_RELEASE_ID, digest: "sha256:abc" }
  }
};

export const catalogProposal: CatalogProposalResponse["item"] = {
  id: CATALOG_PROPOSAL_ID,
  organizationId: CATALOG_ORGANIZATION_ID,
  status: "submitted",
  etag: "etag-p1",
  base: {
    catalogReleaseId: CATALOG_RELEASE_ID,
    definitionId: CATALOG_DEFINITION_ID,
    definitionRevisionId: CATALOG_REVISION_ID
  },
  requestedChange: { kind: "documentation" },
  submittedByPersonId: CATALOG_AUTHOR_PERSON_ID,
  acceptedByPersonId: null,
  publicationIntentRef: null,
  version: 1
};

export const mappedLegacyIdentifier: CatalogLegacyIdentifierResponse = {
  item: {
    legacyType: "parameter-spec",
    legacyId: "spec-sc8562-gpio-int",
    disposition: "mapped",
    target: {
      kind: "parameter-definition",
      id: CATALOG_DEFINITION_ID,
      href: `/api/v2/catalog/definitions/${CATALOG_DEFINITION_ID}`
    },
    historicalOnly: false
  }
};

export function emptyCatalogCollection<T>(
  emptyReason: "no-registrations" | "no-definitions" | "no-review-work" | "no-filter-match"
): { items: T[]; nextCursor: null; catalogReleaseId: string; emptyReason: typeof emptyReason } {
  return {
    items: [],
    nextCursor: null,
    catalogReleaseId: CATALOG_RELEASE_ID,
    emptyReason
  };
}
