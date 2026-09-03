import { describe, expect, it } from "vitest";

import { MAPPING_TARGET_KINDS } from "../../catalog-cutover/mapping/types";
import { apiFailureReasons } from "../../parameter-catalog-contract/index";
import { buildOpenApiDocument } from "../openapi";
import { routeManifest } from "../routeManifest";
import { schemaRegistry } from "../schemaRegistry";
import {
  catalogApiFailureReasons,
  catalogCreateBindingDraftRequestSchema,
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

function openApiPath(path: string) {
  return path.replace(/:([^/]+)/g, "{$1}");
}

describe("S8-CON threat matrix", () => {
  it("keeps PCAT-API-01..12 as the frozen public gate set", () => {
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
      "PCAT-API-12"
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
