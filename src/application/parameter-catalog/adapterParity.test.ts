import { describe, expect, it, vi } from "vitest";
import {
  CATALOG_IDEMPOTENCY_HEADER,
  CATALOG_IF_MATCH_HEADER,
  CATALOG_RELEASE_HEADER,
  catalogForbiddenSpoofHeaders,
  parameterCatalogCanonicalRoutes,
  parameterCatalogClientMethodByRouteId
} from "@wiseeff/dto-schemas";

import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createParameterCatalogClient } from "@/infrastructure/http/parameterCatalogClient";

import { createApiCatalogPorts } from "./apiAdapter";
import {
  CATALOG_AUTHOR_PERSON_ID,
  CATALOG_ORGANIZATION_ID,
  CATALOG_REGISTRATION_ID,
  CATALOG_RELEASE_ID,
  CATALOG_REVIEW_ITEM_ID,
  CATALOG_SUBJECT_ID,
  activeDefinition,
  catalogObservation,
  catalogProposal,
  catalogRegistration,
  catalogReviewItem,
  catalogRevision,
  catalogTimeline,
  emptyCatalogCollection,
  mappedLegacyIdentifier,
  readyCatalogDocument,
  registeredSubject,
  retiredDefinition,
  retiredSubject,
  unregisteredSubject
} from "./fixtures";
import {
  PARAMETER_CATALOG_GOVERNANCE_REPOSITORY_METHODS,
  PARAMETER_CATALOG_REPOSITORY_METHODS
} from "./methods";

const FORBIDDEN_LEGACY_CATALOG_PORT_METHODS = [
  "listSpecs",
  "getSpec",
  "createParameterSpec",
  "activateParameterSpec",
  "updateParameterSpec",
  "deprecateParameterSpec",
  "restoreParameterSpec",
  "reattributeParameterSpec",
  "renameParameterSpecPropertyKey",
  "listSpecReviewTasks",
  "resolveSpecReviewTask",
  "invokeRetiredLegacyRoute"
] as const;
import { createMockCatalogPorts, type CatalogMockScenario } from "./mockAdapter";
import { deriveCatalogDomainState } from "./states";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function errorResponse(status: number, code: string, reason: string) {
  return jsonResponse(
    {
      error: {
        code,
        message: "ignore this human message",
        details: { reason, catalogReleaseId: CATALOG_RELEASE_ID },
        requestId: "req_1"
      }
    },
    status
  );
}

function createScenarioFetch(scenario: CatalogMockScenario): typeof fetch {
  return async (input) => {
    const href = String(input);
    const path = href.split("?")[0] ?? href;
    if (scenario === "error") {
      return errorResponse(503, "SERVICE_UNAVAILABLE", "catalog-not-ready");
    }
    if (path === "/api/v2/catalog") {
      return jsonResponse(readyCatalogDocument);
    }
    if (path === "/api/v2/catalog/subjects") {
      if (scenario === "empty-no-registrations") {
        return jsonResponse(emptyCatalogCollection("no-registrations"));
      }
      if (scenario === "empty-no-filter-match") {
        return jsonResponse(emptyCatalogCollection("no-filter-match"));
      }
      const subject = scenario === "unregistered" ? unregisteredSubject : scenario === "retired" ? retiredSubject : registeredSubject;
      return jsonResponse({
        items: [subject],
        nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      });
    }
    if (path === `/api/v2/catalog/subjects/${CATALOG_SUBJECT_ID}`) {
      const subject = scenario === "unregistered" ? unregisteredSubject : scenario === "retired" ? retiredSubject : registeredSubject;
      return jsonResponse({ item: subject });
    }
    if (path === "/api/v2/catalog/definitions" || path === `/api/v2/catalog/subjects/${CATALOG_SUBJECT_ID}/definitions`) {
      if (scenario === "empty-no-definitions") {
        return jsonResponse(emptyCatalogCollection("no-definitions"));
      }
      if (scenario === "empty-no-filter-match") {
        return jsonResponse(emptyCatalogCollection("no-filter-match"));
      }
      const definition = scenario === "retired" ? retiredDefinition : activeDefinition;
      return jsonResponse({
        items: [definition],
        nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      });
    }
    if (path === `/api/v2/catalog/definitions/${activeDefinition.id}`) {
      return jsonResponse({ item: scenario === "retired" ? retiredDefinition : activeDefinition });
    }
    if (path === `/api/v2/catalog/definitions/${activeDefinition.id}/revisions`) {
      return jsonResponse({
        items: [catalogRevision],
        nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      });
    }
    if (path === `/api/v2/catalog/definitions/${activeDefinition.id}/revisions/${catalogRevision.id}`) {
      return jsonResponse({ item: catalogRevision });
    }
    if (path === `/api/v2/catalog/definitions/${activeDefinition.id}/timeline`) {
      return jsonResponse(catalogTimeline);
    }
    if (path === `/api/v2/organizations/${CATALOG_ORGANIZATION_ID}/parameter-review-items`) {
      if (scenario === "empty-no-review-work") {
        return jsonResponse(emptyCatalogCollection("no-review-work"));
      }
      return jsonResponse({
        items: [catalogReviewItem],
        nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      });
    }
    if (path === `/api/v2/catalog/legacy-identifiers/parameter-spec/spec-sc8562-gpio-int`) {
      if (scenario === "retired") {
        return errorResponse(410, "GONE", "legacy-id-archived");
      }
      if (scenario === "conflict") {
        return errorResponse(409, "CONFLICT", "legacy-id-ambiguous");
      }
      return jsonResponse(mappedLegacyIdentifier);
    }
    if (path.includes("/parameter-review-items/") && path.endsWith("/resolve")) {
      if (scenario === "conflict") {
        return errorResponse(409, "CONFLICT", "release-drift");
      }
      return jsonResponse({
        item: {
          reviewItem: { id: CATALOG_REVIEW_ITEM_ID, status: "resolved" },
          catalogReleaseId: CATALOG_RELEASE_ID
        }
      });
    }
    if (path === `/api/v2/organizations/${CATALOG_ORGANIZATION_ID}/parameter-observations`) {
      return jsonResponse({
        items: [catalogObservation],
        nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      });
    }
    if (path === "/api/v2/catalog/definition-proposals") {
      return jsonResponse({
        items: [catalogProposal],
        nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      });
    }
    if (path === `/api/v2/organizations/${CATALOG_ORGANIZATION_ID}/subject-registrations`) {
      if (scenario === "empty-no-registrations" || scenario === "unregistered") {
        return jsonResponse(emptyCatalogCollection("no-registrations"));
      }
      return jsonResponse({
        items: [catalogRegistration],
        nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      });
    }
    return errorResponse(404, "NOT_FOUND", "definition-not-found");
  };
}

function methodNames(value: object): string[] {
  return Object.keys(value).sort();
}

describe("catalog API and mock adapter parity", () => {
  it("covers every frozen canonical client method on exactly one port", () => {
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: vi.fn() });
    const api = createApiCatalogPorts(client);
    const mock = createMockCatalogPorts();
    expect(methodNames(api.catalog)).toEqual([...PARAMETER_CATALOG_REPOSITORY_METHODS].sort());
    expect(methodNames(api.governance)).toEqual([...PARAMETER_CATALOG_GOVERNANCE_REPOSITORY_METHODS].sort());
    expect(methodNames(api.catalog)).toEqual(methodNames(mock.catalog));
    expect(methodNames(api.governance)).toEqual(methodNames(mock.governance));

    for (const route of parameterCatalogCanonicalRoutes) {
      const methodName = parameterCatalogClientMethodByRouteId[route.id];
      const onCatalog = methodName in api.catalog;
      const onGovernance = methodName in api.governance;
      expect(onCatalog !== onGovernance, methodName).toBe(true);
      expect(typeof (onCatalog ? api.catalog : api.governance)[methodName as never], methodName).toBe(
        "function"
      );
    }
  });

  it("rejects Effective/Governance extra power on both adapters", () => {
    const api = createApiCatalogPorts(createParameterCatalogClient({ baseUrl: "", fetchImpl: vi.fn() }));
    const mock = createMockCatalogPorts();
    for (const methodName of FORBIDDEN_LEGACY_CATALOG_PORT_METHODS) {
      expect(methodName in api.catalog, methodName).toBe(false);
      expect(methodName in api.governance, methodName).toBe(false);
      expect(methodName in mock.catalog, methodName).toBe(false);
      expect(methodName in mock.governance, methodName).toBe(false);
    }
  });

  it("replays the closed state corpus with identical derived states", async () => {
    const cases: Array<{
      scenario: CatalogMockScenario;
      run: (ports: ReturnType<typeof createMockCatalogPorts>) => Promise<unknown>;
      expectedKind: string;
    }> = [
      {
        scenario: "ready",
        run: (ports) => ports.catalog.getCatalog(),
        expectedKind: "ready"
      },
      {
        scenario: "unregistered",
        run: (ports) => ports.catalog.getSubject(CATALOG_SUBJECT_ID),
        expectedKind: "unregistered"
      },
      {
        scenario: "empty-no-definitions",
        run: (ports) => ports.catalog.listDefinitions(),
        expectedKind: "empty"
      },
      {
        scenario: "empty-no-review-work",
        run: (ports) => ports.governance.listReviewItems(CATALOG_ORGANIZATION_ID),
        expectedKind: "empty"
      },
      {
        scenario: "error",
        run: (ports) => ports.catalog.getCatalog(),
        expectedKind: "error"
      },
      {
        scenario: "retired",
        run: (ports) => ports.catalog.getDefinition(activeDefinition.id),
        expectedKind: "retired"
      },
      {
        scenario: "conflict",
        run: (ports) => ports.catalog.getLegacyIdentifier("parameter-spec", "spec-sc8562-gpio-int"),
        expectedKind: "conflict"
      }
    ];

    for (const testCase of cases) {
      const mock = createMockCatalogPorts({ scenario: testCase.scenario });
      const api = createApiCatalogPorts(
        createParameterCatalogClient({
          baseUrl: "",
          fetchImpl: createScenarioFetch(testCase.scenario)
        })
      );
      const mockResult = await testCase.run(mock).then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error })
      );
      const apiResult = await testCase.run(api).then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error })
      );
      const mockState = deriveCatalogDomainState({
        document: readyCatalogDocument,
        subject:
          testCase.scenario === "unregistered"
            ? unregisteredSubject
            : testCase.scenario === "retired"
              ? retiredSubject
              : undefined,
        definition:
          testCase.scenario === "retired"
            ? retiredDefinition
            : testCase.scenario === "ready"
              ? activeDefinition
              : undefined,
        collection:
          mockResult.value && typeof mockResult.value === "object" && "emptyReason" in mockResult.value
            ? (mockResult.value as { items: unknown[]; catalogReleaseId: string; emptyReason?: string })
            : undefined,
        error: mockResult.error
      });
      const apiState = deriveCatalogDomainState({
        document: readyCatalogDocument,
        subject:
          testCase.scenario === "unregistered"
            ? unregisteredSubject
            : testCase.scenario === "retired"
              ? retiredSubject
              : undefined,
        definition:
          testCase.scenario === "retired"
            ? retiredDefinition
            : testCase.scenario === "ready"
              ? activeDefinition
              : undefined,
        collection:
          apiResult.value && typeof apiResult.value === "object" && "emptyReason" in apiResult.value
            ? (apiResult.value as { items: unknown[]; catalogReleaseId: string; emptyReason?: string })
            : undefined,
        error: apiResult.error
      });
      expect(mockState.kind, testCase.scenario).toBe(testCase.expectedKind);
      expect(apiState.kind, testCase.scenario).toBe(testCase.expectedKind);
      expect(apiState, testCase.scenario).toEqual(mockState);
    }
  });

  it("sends release, If-Match, and Idempotency-Key and never spoofs a role", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        item: {
          reviewItem: { id: CATALOG_REVIEW_ITEM_ID, status: "resolved" },
          catalogReleaseId: CATALOG_RELEASE_ID
        }
      })
    );
    const { governance } = createApiCatalogPorts(
      createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock })
    );
    await governance.resolveReviewItem(
      CATALOG_ORGANIZATION_ID,
      CATALOG_REVIEW_ITEM_ID,
      {
        resolution: {
          type: "register-subject",
          subjectId: CATALOG_SUBJECT_ID,
          placement: { mode: "use-default" }
        },
        reason: "explicit placement"
      },
      { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-1", ifMatch: "etag-1" }
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers[CATALOG_RELEASE_HEADER]).toBe(CATALOG_RELEASE_ID);
    expect(headers[CATALOG_IF_MATCH_HEADER]).toBe("etag-1");
    expect(headers[CATALOG_IDEMPOTENCY_HEADER]).toBe("key-1");
    for (const spoof of catalogForbiddenSpoofHeaders) {
      expect(headers[spoof]).toBeUndefined();
    }
  });

  it("requires If-Match before a review resolve on both adapters", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ item: {} }));
    const api = createApiCatalogPorts(
      createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock })
    );
    const mock = createMockCatalogPorts();
    const body = {
      resolution: { type: "mark-out-of-scope" as const },
      reason: "out of scope"
    };
    const incomplete = { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-1" };
    await expect(
      api.governance.resolveReviewItem(
        CATALOG_ORGANIZATION_ID,
        CATALOG_REVIEW_ITEM_ID,
        body,
        incomplete as never
      )
    ).rejects.toMatchObject({ details: { reason: "revision-conflict" } });
    await expect(
      mock.governance.resolveReviewItem(
        CATALOG_ORGANIZATION_ID,
        CATALOG_REVIEW_ITEM_ID,
        body,
        incomplete as never
      )
    ).rejects.toMatchObject({ details: { reason: "revision-conflict" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not let mock infer placement, restore placement, or silently retry", async () => {
    const mock = createMockCatalogPorts({ scenario: "unregistered" });
    await expect(
      mock.governance.createRegistration(
        CATALOG_ORGANIZATION_ID,
        { subjectId: CATALOG_SUBJECT_ID } as never,
        { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-1" }
      )
    ).rejects.toThrow();

    const registered = createMockCatalogPorts();
    await expect(
      registered.governance.restoreRegistration(
        CATALOG_ORGANIZATION_ID,
        CATALOG_REGISTRATION_ID,
        { reason: "restore", placement: { mode: "use-default" } } as never,
        { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-2", ifMatch: "etag-reg" }
      )
    ).rejects.toThrow();

    await expect(
      registered.governance.resolveReviewItem(
        CATALOG_ORGANIZATION_ID,
        CATALOG_REVIEW_ITEM_ID,
        {
          resolution: { type: "mark-out-of-scope" },
          reason: "stale"
        },
        { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-3", ifMatch: "stale-etag" }
      )
    ).rejects.toMatchObject({ details: { reason: "revision-conflict" } });
    await expect(
      registered.governance.resolveReviewItem(
        CATALOG_ORGANIZATION_ID,
        CATALOG_REVIEW_ITEM_ID,
        {
          resolution: { type: "mark-out-of-scope" },
          reason: "stale"
        },
        { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-3", ifMatch: "stale-etag" }
      )
    ).rejects.toMatchObject({ details: { reason: "revision-conflict" } });
  });

  it("refuses self-approval and catalog-not-ready writes without extra mock power", async () => {
    const self = createMockCatalogPorts({ currentPersonId: CATALOG_AUTHOR_PERSON_ID });
    await expect(
      self.governance.acceptProposal(
        catalogProposal.id,
        { repositoryReference: "repo@sha" },
        { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-4", ifMatch: catalogProposal.etag }
      )
    ).rejects.toMatchObject({ details: { reason: "proposal-self-approval-forbidden" } });

    const unavailable = createMockCatalogPorts({ scenario: "error" });
    await expect(
      unavailable.governance.createRegistration(
        CATALOG_ORGANIZATION_ID,
        { subjectId: CATALOG_SUBJECT_ID, placement: { mode: "use-default" } },
        { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-5" }
      )
    ).rejects.toMatchObject({ details: { reason: "catalog-not-ready" } });
    expect(unavailable.governance).not.toHaveProperty("createParameterSpec");
  });

  it("replays an exact idempotent register and conflicts on fingerprint reuse", async () => {
    const mock = createMockCatalogPorts({ scenario: "unregistered" });
    const context = { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "register-1" };
    const body = {
      subjectId: CATALOG_SUBJECT_ID,
      placement: { mode: "use-default" as const }
    };
    const first = await mock.governance.createRegistration(CATALOG_ORGANIZATION_ID, body, context);
    const second = await mock.governance.createRegistration(CATALOG_ORGANIZATION_ID, body, context);
    expect(second).toEqual(first);
    await expect(
      mock.governance.createRegistration(
        CATALOG_ORGANIZATION_ID,
        {
          subjectId: CATALOG_SUBJECT_ID,
          placement: { mode: "choose-parent", parentPlacementId: "splc_other", displayName: "Other" }
        },
        context
      )
    ).rejects.toMatchObject({ details: { reason: "revision-conflict" } });
  });

  it("keeps loading algebra write-disabled even when mock still has a previous snapshot", async () => {
    const mock = createMockCatalogPorts();
    const document = await mock.catalog.getCatalog();
    const state = deriveCatalogDomainState({
      inFlight: true,
      previousReleaseId: document.item.catalogReleaseId,
      document
    });
    expect(state).toMatchObject({ kind: "loading", stale: true, writesEnabled: false });
  });

  it("surfaces API conflict as WiseEffApiError branched on details.reason", async () => {
    const api = createApiCatalogPorts(
      createParameterCatalogClient({
        baseUrl: "",
        fetchImpl: createScenarioFetch("conflict")
      })
    );
    await expect(
      api.governance.resolveReviewItem(
        CATALOG_ORGANIZATION_ID,
        CATALOG_REVIEW_ITEM_ID,
        {
          resolution: { type: "mark-out-of-scope" },
          reason: "stale"
        },
        { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-6", ifMatch: "etag-1" }
      )
    ).rejects.toBeInstanceOf(WiseEffApiError);
  });
});
