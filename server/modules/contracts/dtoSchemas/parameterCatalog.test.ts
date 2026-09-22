import { describe, expect, it } from "vitest";

import { MAPPING_TARGET_KINDS } from "../../catalog-cutover/mapping/types";
import { apiFailureReasons } from "../../parameter-catalog-contract/index";
import { buildOpenApiDocument } from "../openapi";
import { routeManifest } from "../routeManifest";
import { schemaRegistry } from "../schemaRegistry";
import {
  catalogAcceptProposalRequestSchema,
  catalogBindingDraftDtoSchema,
  catalogBindingExportDtoSchema,
  catalogBindingChangeHistoryEntryDtoSchema,
  canonicalSourceManifestSchema,
  catalogApiFailureReasons,
  catalogCreateBindingDraftRequestSchema,
  catalogCreatePublicationCandidateRequestSchema,
  catalogDefinitionDtoSchema,
  catalogDocumentResponseSchema,
  catalogFailureClientBehaviors,
  catalogKernelReadOperations,
  catalogLegacyGoneResponseSchema,
  catalogLegacyIdentifierDtoSchema,
  catalogMappingTargetKinds,
  catalogPlacementIntentSchema,
  catalogProjectBindingDtoSchema,
  catalogRegisterSubjectRequestSchema,
  catalogResolveReviewItemRequestSchema,
  catalogSubjectDtoSchema,
  pcatApiGates,
  parameterCatalogBoundedLegacyReadRouteIds,
  parameterCatalogCanonicalRoutes,
  parameterCatalogClientMethodByRouteId,
  parameterCatalogCoveredRouteIds,
  parameterCatalogDtoSchemaCatalog,
  parameterCatalogKernelReadByRouteId,
  parameterCatalogLegacyWriteRouteIds,
  parameterCatalogProjectBindingRouteIds,
  parameterCatalogRouteGates,
  projectParameterBindingListResponseSchema
} from "./parameterCatalog";

const openApi = buildOpenApiDocument();

describe("catalog definition usage summary", () => {
  it("distinguishes unavailable policy usage from a known zero", () => {
    const definition = {
      id: "pdef_usage",
      subject: { id: "csub_usage", type: "driver", canonicalName: "driver:usage" },
      propertyKey: "usage",
      lifecycle: "active",
      currentRevision: {
        id: "drev_usage",
        definitionId: "pdef_usage",
        revisionNumber: 1,
        contentDigest: "sha256:usage",
        displayName: "Usage",
        valueShape: { kind: "json-schema", schema: { type: "integer" } },
        constraints: { kind: "none" },
        documentation: null,
        unit: null,
        publishedInCatalogReleaseId: "crel_usage"
      },
      registration: { status: "unregistered" },
      links: { revisions: "/revisions", timeline: "/timeline" }
    } as const;
    const parse = (policyCount: number | null) =>
      catalogDefinitionDtoSchema.parse({
        ...definition,
        usageSummary: { policyCount, projectCount: 2, currentValueCount: 1 }
      });

    expect(parse(null).usageSummary).toEqual({ policyCount: null, projectCount: 2, currentValueCount: 1 });
    expect(parse(0).usageSummary.policyCount).toBe(0);
    expect(parse(3).usageSummary.policyCount).toBe(3);
    expect(catalogDefinitionDtoSchema.safeParse({ ...definition, usageSummary: { policyCount: 0.5, projectCount: 0, currentValueCount: 0 } }).success).toBe(false);
    expect(catalogDefinitionDtoSchema.safeParse({ ...definition, usageSummary: { policyCount: -1, projectCount: 0, currentValueCount: 0 } }).success).toBe(false);
    expect(catalogDefinitionDtoSchema.safeParse({ ...definition, usageSummary: { policyCount: "0", projectCount: 0, currentValueCount: 0 } }).success).toBe(false);
  });
});

describe("canonical deletion wire contract", () => {
  it("preserves a JSON delete action without deriving it from an empty target", () => {
    const draft = {
      id: "draft", bindingId: "binding", definitionId: "definition", effectiveRevisionId: "definition-revision",
      currentValueId: "base-value", action: "delete", targetValue: "", sourceFormat: "json",
      baseRevisionId: "revision", sourcePinId: "base-pin", candidateId: "candidate",
      reason: "Remove obsolete property", updatedAt: "2026-09-21T00:00:00Z",
    };
    expect(catalogBindingDraftDtoSchema.parse(draft)).toMatchObject({ action: "delete", sourceFormat: "json", targetValue: "" });
    expect(catalogBindingDraftDtoSchema.safeParse({ ...draft, action: undefined }).success).toBe(false);
    expect(catalogBindingDraftDtoSchema.safeParse({ ...draft, targetValue: "null" }).success).toBe(false);
    expect(catalogBindingDraftDtoSchema.safeParse({ ...draft, sourceTarget: { format: "json", sourceText: "" } }).success).toBe(false);
  });

  it.each(["dts", "json"] as const)("requires an explicit %s deleted manifest and its exact proof", (format) => {
    const digest = `sha256:${"a".repeat(64)}`;
    const anchor = format === "json"
      ? { rootPointer: "/a~1b", pointer: "/a~1b/", parentPointer: "/a~1b", memberKey: "" }
      : { nodeOccurrenceId: "node-occurrence", propertyName: "iin_max" };
    const manifest = {
      organizationId: "org", projectId: "project", bindingId: "binding", definitionId: "definition",
      projectValueId: "deleted-value", sourcePinId: "delete-pin", sourceOccurrenceId: "occurrence",
      configSetId: "set", configRevisionId: "revision", fileId: "file", fileVersionId: "version", format,
      logicalNodeId: format === "dts" ? "node" : null,
      configurationInstanceId: format === "json" ? "instance" : null,
      configurationSchemaSubjectId: format === "json" ? "subject" : null,
      rootPointer: format === "json" ? "/a~1b" : null,
      entryFile: null, includeSearchPaths: [], overlayOrder: [], members: [],
      valueState: "deleted", baseSourcePinId: "base-pin", deleteRequestId: "request",
      locator: { kind: `${format}-delete`, fileVersionId: "version", ...anchor },
      deleteProof: { kind: `${format}-delete-v1`, beforeValueDigest: digest, beforeSourceDigest: digest,
        afterSourceDigest: digest, scannerVersion: format === "json" ? "json-span-v1" : "dts-cst-v1", ...anchor },
    };
    expect(canonicalSourceManifestSchema.parse(manifest)).toMatchObject({ valueState: "deleted", deleteRequestId: "request" });
    expect(canonicalSourceManifestSchema.safeParse({ ...manifest, valueState: "present" }).success).toBe(false);
    expect(canonicalSourceManifestSchema.safeParse({ ...manifest, baseSourcePinId: null }).success).toBe(false);
    expect(canonicalSourceManifestSchema.safeParse({ ...manifest, locator: { ...manifest.locator, extra: true } }).success).toBe(false);
    expect(canonicalSourceManifestSchema.safeParse({ ...manifest, deleteProof: { ...manifest.deleteProof, extra: true } }).success).toBe(false);
    expect(canonicalSourceManifestSchema.safeParse({ ...manifest, deleteProof: { ...manifest.deleteProof, afterSourceDigest: "unverified" } }).success).toBe(false);
    expect(canonicalSourceManifestSchema.safeParse({ ...manifest, deleteProof: {
      ...manifest.deleteProof, ...(format === "json" ? { memberKey: "wrong" } : { propertyName: "wrong" }),
    } }).success).toBe(false);
    const exported = {
      bindingId: "binding", projectId: "project", definitionId: "definition", definitionRevisionId: "definition-revision",
      catalogReleaseId: "release", configRevisionId: "revision", currentValueId: "deleted-value", configSetId: "set",
      sourceRef: "source", files: [], valueState: "deleted", manifest,
    };
    expect(catalogBindingExportDtoSchema.safeParse(exported).success).toBe(true);
    expect(catalogBindingExportDtoSchema.safeParse({ ...exported, valueState: "present" }).success).toBe(false);
  });

  it("does not strip deletion state from value history", () => {
    const history = {
      id: "history", bindingId: "binding", definitionId: "definition", oldDefinitionRevisionId: null,
      newDefinitionRevisionId: null, oldCurrentValueId: "base", newCurrentValueId: "deleted",
      valueState: "deleted", reason: "Remove obsolete property", successAuditRef: "audit", catalogReleaseId: "release",
      createdAt: "2026-09-21T00:00:00Z",
    };
    expect(catalogBindingChangeHistoryEntryDtoSchema.parse(history)).toMatchObject({ valueState: "deleted" });
  });
});

function openApiPath(path: string) {
  return path.replace(/:([^/]+)/g, "{$1}");
}

describe("S8-CON threat matrix", () => {
  it("keeps PCAT-API-01..13 as the frozen public gate set", () => {
    // PCAT-API-13 is the definition identity correction migration gate added by
    // issue #847 decision 12; the 01..12 set stays frozen and unchanged.
    expect([...pcatApiGates]).toEqual([
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
    ]);
  });

  it("fails closed when a canonical catalog route is missing from the manifest or OpenAPI", () => {
    for (const route of parameterCatalogCanonicalRoutes) {
      const manifested = routeManifest.find((entry) => entry.id === route.id);
      expect(manifested, `missing route ${route.id}`).toMatchObject({
        id: route.id,
        method: route.method,
        path: route.path,
        module: "catalog"
      });
      const pathItem = openApi.paths[openApiPath(route.path)];
      expect(pathItem, `missing OpenAPI path ${route.path}`).toBeDefined();
      expect(pathItem?.[route.method.toLowerCase() as "get"], route.id).toMatchObject({
        operationId: route.id
      });
      expect(schemaRegistry[route.id], `missing schema registry ${route.id}`).toBeDefined();
    }
  });

  it("covers every PCAT-API gate with a frozen route, reason, or client branch", () => {
    const covered = new Set<string>();
    for (const gates of Object.values(parameterCatalogRouteGates)) {
      for (const gate of gates) covered.add(gate);
    }
    if (parameterCatalogLegacyWriteRouteIds.length > 0) covered.add("PCAT-API-08");
    if (parameterCatalogProjectBindingRouteIds.length > 0) covered.add("PCAT-API-12");
    expect([...pcatApiGates].filter((gate) => !covered.has(gate))).toEqual([]);
    expect(parameterCatalogLegacyWriteRouteIds.length).toBeGreaterThan(0);
    expect(parameterCatalogProjectBindingRouteIds).toEqual([
      "parameterTopology.listBindings",
      "parameterTopology.getBindingHistory",
      "parameterTopology.getBindingCompare",
      "parameterTopology.createBindingDraft",
      "parameterTopology.createNodeEnablementDraft"
    ]);
  });

  it("fails closed when a catalog error reason is missing from the DTO or client behavior table", () => {
    expect([...catalogApiFailureReasons]).toEqual([...apiFailureReasons]);
    for (const reason of catalogApiFailureReasons) {
      expect(catalogFailureClientBehaviors[reason], reason).toEqual(expect.any(String));
    }
    expect(catalogFailureClientBehaviors["catalog-not-ready"]).toBe("disable-writes-retry-after");
    expect(catalogFailureClientBehaviors["legacy-surface-retired"]).toBe("migrate-to-successor-no-retry");
    expect(catalogFailureClientBehaviors["migration-diagnostics-not-public"]).toBe("treat-as-not-found");
    expect(catalogFailureClientBehaviors["publication-policy-disabled"]).toBe("publication-disabled");
    expect(catalogFailureClientBehaviors["idempotency-key-conflict"]).toBe("new-idempotency-key");
    expect(catalogFailureClientBehaviors["needs-rebase"]).toBe("rebase-candidate");
    expect(catalogFailureClientBehaviors["activation-receipt-mismatch"]).toBe("inspect-receipt-no-retry");
  });

  it("freezes publication routes without v3, /admin, cancel, or retry", () => {
    const publication = parameterCatalogCanonicalRoutes.filter((route) =>
      route.path.includes("publication")
    );
    expect(publication.map((route) => `${route.method} ${route.path}`)).toEqual([
      "POST /api/v2/catalog/publication-candidates",
      "GET /api/v2/catalog/publication-candidates/:candidateId",
      "POST /api/v2/catalog/publication-candidates/:candidateId/publish",
      "GET /api/v2/catalog/publication-surface",
      "GET /api/v2/catalog/publications",
      "GET /api/v2/catalog/publications/:jobId"
    ]);
    expect(
      parameterCatalogCanonicalRoutes.some((route) => route.path.includes("/admin") || route.path.includes("/v3/"))
    ).toBe(false);
    expect(
      parameterCatalogCanonicalRoutes.some((route) =>
        route.path.includes("cancel") || route.path.endsWith("/retry")
      )
    ).toBe(false);
    expect(parameterCatalogClientMethodByRouteId["catalog.createPublicationCandidate"]).toBe(
      "createPublicationCandidate"
    );
    expect(parameterCatalogClientMethodByRouteId["catalog.getPublication"]).toBe("getPublication");
  });

  it("accepts M2 create-subject and revise-definition on the frozen candidate request", () => {
    expect(
      catalogCreatePublicationCandidateRequestSchema.parse({
        changeSet: [
          {
            op: "create-subject-with-definitions",
            kind: "driver",
            canonicalKey: "driver:acme,aux",
            selector: { kind: "driver-compatible", value: "acme,aux" },
            nature: "physical-device",
            cardinality: "multiple",
            definitions: [
              {
                propertyKey: "vbat",
                content: {
                  displayName: "Aux",
                  documentation: "Aux voltage.",
                  unit: "mA",
                  valueSchema: { type: "integer", minimum: 0 }
                }
              }
            ]
          }
        ]
      }).changeSet[0]?.op
    ).toBe("create-subject-with-definitions");
    expect(
      catalogCreatePublicationCandidateRequestSchema.safeParse({
        changeSet: [
          {
            op: "create-subject-with-definitions",
            kind: "driver",
            canonicalKey: "driver:acme,aux",
            selector: { kind: "driver-compatible", value: "acme,aux" },
            definitions: [
              {
                subjectId: "csub_acme_power",
                propertyKey: "vbat",
                content: {
                  displayName: "Aux",
                  documentation: "Aux voltage.",
                  valueSchema: { type: "integer" }
                }
              }
            ]
          }
        ]
      }).success
    ).toBe(false);
  });

  it("fails closed when a canonical client method is missing for a catalog route", () => {
    for (const route of parameterCatalogCanonicalRoutes) {
      expect(parameterCatalogClientMethodByRouteId[route.id], route.id).toEqual(expect.any(String));
    }
    expect(Object.keys(parameterCatalogClientMethodByRouteId).sort()).toEqual(
      parameterCatalogCanonicalRoutes.map((route) => route.id).sort()
    );
  });

  it("closes the nine Kernel read routes without a silent hole", () => {
    expect(Object.keys(parameterCatalogKernelReadByRouteId)).toHaveLength(9);
    expect(new Set(Object.values(parameterCatalogKernelReadByRouteId))).toEqual(
      new Set(catalogKernelReadOperations)
    );
    expect(schemaRegistry["catalog.get"]?.additionalResponses?.["503"]).toBe("ErrorResponse");
  });

  it("realizes DTO schemas for every covered catalog route instead of OpenAPI placeholders", () => {
    for (const routeId of parameterCatalogCoveredRouteIds) {
      const entry = schemaRegistry[routeId];
      expect(entry, routeId).toBeDefined();
      const response = parameterCatalogDtoSchemaCatalog[
        entry.responseBody as keyof typeof parameterCatalogDtoSchemaCatalog
      ];
      expect(response, `${routeId} ${entry.responseBody}`).toBeDefined();
      const schema = openApi.components.schemas[entry.responseBody] as Record<string, unknown>;
      expect(schema, entry.responseBody).toBeDefined();
      expect(schema["x-wiseeff-schema"]).toBe(entry.responseBody);
      expect(schema.type === "object" || Array.isArray(schema.anyOf)).toBe(true);
      if (schema.type === "object") {
        expect(schema.properties, entry.responseBody).toBeDefined();
      }
      if (entry.requestBody) {
        const request = parameterCatalogDtoSchemaCatalog[
          entry.requestBody as keyof typeof parameterCatalogDtoSchemaCatalog
        ];
        if (parameterCatalogCanonicalRoutes.some((route) => route.id === routeId)) {
          expect(request, `${routeId} ${entry.requestBody}`).toBeDefined();
        }
      }
    }
  });

  it("keeps producer PlacementIntent, mapping targets, and registration/review unions on the wire", () => {
    expect(catalogPlacementIntentSchema.safeParse({ mode: "use-default" }).success).toBe(true);
    expect(
      catalogPlacementIntentSchema.safeParse({
        mode: "choose-parent",
        parentPlacementId: "spla_root_drivers",
        displayName: "Charging ICs"
      }).success
    ).toBe(true);
    expect(catalogPlacementIntentSchema.safeParse({ mode: "infer-parent" }).success).toBe(false);
    expect([...catalogMappingTargetKinds]).toEqual([...MAPPING_TARGET_KINDS]);
    expect(
      catalogRegisterSubjectRequestSchema.safeParse({
        subjectId: "csub_01K",
        placement: { mode: "use-default" }
      }).success
    ).toBe(true);
    expect(
      catalogResolveReviewItemRequestSchema.safeParse({
        resolution: { type: "restore-registration", registrationId: "sreg_01K" },
        reason: "restore retained placement"
      }).success
    ).toBe(true);
    expect(
      catalogResolveReviewItemRequestSchema.safeParse({
        resolution: {
          type: "restore-registration",
          registrationId: "sreg_01K",
          placement: { mode: "use-default" }
        },
        reason: "illegal extra placement"
      }).success
    ).toBe(false);
    expect(
      catalogAcceptProposalRequestSchema.safeParse({
        repositoryReference: "repo://wiseeff-catalog/acme-power.yaml"
      }).success
    ).toBe(true);
    expect(
      catalogAcceptProposalRequestSchema.safeParse({
        publicationReference: { kind: "candidate", candidateId: "ccand_01K" }
      }).success
    ).toBe(true);
    expect(
      catalogAcceptProposalRequestSchema.safeParse({
        repositoryReference: "repo://wiseeff-catalog/acme-power.yaml",
        publicationReference: { kind: "candidate", candidateId: "ccand_01K" }
      }).success
    ).toBe(false);
  });

  it("rejects parameterSpecId on catalog and project-binding DTOs", () => {
    const binding = {
      id: "pbind_01KPROJECT",
      projectId: "project_1",
      logicalNodeId: "lnode_sc8562_1",
      subjectRegistrationId: "sreg_01KACME",
      definitionId: "pdef_01KGPIOINT",
      effectiveRevisionId: "drev_01K6",
      currentValueId: "pval_01KVALUE",
      recognizedAgainstCatalogReleaseId: "crel_01K41"
    };
    expect(catalogProjectBindingDtoSchema.safeParse(binding).success).toBe(true);
    expect(
      catalogProjectBindingDtoSchema.safeParse({ ...binding, parameterSpecId: "spec-1" }).success
    ).toBe(false);
    expect(
      projectParameterBindingListResponseSchema.safeParse({
        items: [{ ...binding, parameter_spec_id: "spec-1" }],
        nextCursor: null,
        catalogReleaseId: "crel_01K42"
      }).success
    ).toBe(false);
    expect(
      catalogCreateBindingDraftRequestSchema.safeParse({
        definitionId: "pdef_01KGPIOINT",
        effectiveRevisionId: "drev_01K6",
        targetValue: "1",
        reason: "pin canonical revision",
        parameterSpecId: "spec-1"
      }).success
    ).toBe(false);
  });

  it("parses the frozen catalog document, unregistered subject, and mapped legacy identifier", () => {
    expect(
      catalogDocumentResponseSchema.safeParse({
        item: {
          catalogReleaseId: "crel_01K42",
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
      }).success
    ).toBe(true);
    expect(
      catalogSubjectDtoSchema.safeParse({
        id: "csub_01KSC8562",
        type: "driver",
        canonicalName: "southchip,sc8562",
        aliases: ["sc8562"],
        membership: { status: "active", catalogReleaseId: "crel_01K42" },
        registration: { status: "unregistered" },
        definitionCounts: { active: 14, deprecated: 1, retired: 0 },
        availableActions: ["register"]
      }).success
    ).toBe(true);
    expect(
      catalogLegacyIdentifierDtoSchema.safeParse({
        legacyType: "parameter-spec",
        legacyId: "spec-sc8562-gpio-int",
        disposition: "mapped",
        target: {
          kind: "parameter-definition",
          id: "pdef_01KGPIOINT",
          href: "/api/v2/catalog/definitions/pdef_01KGPIOINT"
        },
        historicalOnly: false
      }).success
    ).toBe(true);
    expect(
      catalogLegacyGoneResponseSchema.safeParse({
        error: {
          code: "GONE",
          message: "Legacy structural writes are retired.",
          details: {
            reason: "legacy-surface-retired",
            successor: "/api/v2/catalog",
            retryable: false
          },
          requestId: "req_01K"
        }
      }).success
    ).toBe(true);
  });

  it("marks immediate-410 legacy writes and keeps operator diagnostics off the public contract", () => {
    for (const routeId of parameterCatalogLegacyWriteRouteIds) {
      expect(schemaRegistry[routeId]?.successStatus, routeId).toBe(410);
      expect(schemaRegistry[routeId]?.responseBody, routeId).toBe("CatalogLegacyGoneResponse");
    }
    for (const routeId of parameterCatalogBoundedLegacyReadRouteIds) {
      expect(schemaRegistry[routeId]?.additionalResponses?.["410"], routeId).toBe("ErrorResponse");
    }
    expect(
      routeManifest.some((route) => route.path.startsWith("/api/v2/operator/parameter-catalog"))
    ).toBe(false);
    expect(Object.keys(openApi.paths).some((path) => path.startsWith("/api/v2/operator/parameter-catalog"))).toBe(
      false
    );
  });

  it("requires release, ETag, and idempotency headers on governance writes", () => {
    const resolve = schemaRegistry["catalog.resolveReviewItem"];
    const headerNames = (resolve.requestParameters ?? []).map((parameter) => parameter.name);
    expect(headerNames).toEqual(
      expect.arrayContaining(["X-WiseEff-Catalog-Release", "If-Match", "Idempotency-Key"])
    );
    expect(resolve.successHeaders?.map((header) => header.name)).toEqual(
      expect.arrayContaining(["X-WiseEff-Catalog-Release", "ETag"])
    );
  });
});
