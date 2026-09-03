import { describe, expect, it, vi } from "vitest";

import {
  catalogFailureClientBehaviors,
  catalogForbiddenSpoofHeaders,
  parameterCatalogCanonicalRoutes,
  parameterCatalogClientMethodByRouteId
} from "@wiseeff/dto-schemas";
import { WiseEffApiError } from "./apiClient";
import {
  catalogFailureClientBehavior,
  catalogFailureReason,
  createParameterCatalogClient
} from "./parameterCatalogClient";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

const catalogDocument = {
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
};

describe("parameter catalog client contract", () => {
  it("exposes a typed method for every frozen canonical route", () => {
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: vi.fn() });
    for (const route of parameterCatalogCanonicalRoutes) {
      const methodName = parameterCatalogClientMethodByRouteId[route.id];
      expect(client[methodName as keyof typeof client], methodName).toEqual(expect.any(Function));
    }
  });

  it("reads GET /api/v2/catalog through the frozen document schema", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(catalogDocument));
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });
    await expect(client.getCatalog()).resolves.toEqual(catalogDocument);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/catalog",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("sends release, If-Match, and Idempotency-Key on review resolution and never spoofs a role", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        item: {
          reviewItem: { id: "prev_01KAMBIG", status: "resolved" },
          catalogReleaseId: "crel_01K42"
        }
      })
    );
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });
    await client.resolveReviewItem(
      "org_acme",
      "prev_01KAMBIG",
      {
        resolution: { type: "register-subject", subjectId: "csub_01K", placement: { mode: "use-default" } },
        reason: "explicit placement"
      },
      { catalogReleaseId: "crel_01K42", idempotencyKey: "key-1", ifMatch: "etag-1" }
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v2/organizations/org_acme/parameter-review-items/prev_01KAMBIG/resolve"
    );
    expect(headers["X-WiseEff-Catalog-Release"]).toBe("crel_01K42");
    expect(headers["If-Match"]).toBe("etag-1");
    expect(headers["Idempotency-Key"]).toBe("key-1");
    for (const spoof of catalogForbiddenSpoofHeaders) {
      expect(headers[spoof]).toBeUndefined();
    }
  });

  it("branches on stable details.reason and never parses the human message", () => {
    const error = new WiseEffApiError(
      "CONFLICT",
      "ignore this human message",
      { reason: "release-drift" },
      "req_1"
    );
    expect(catalogFailureReason(error)).toBe("release-drift");
    expect(catalogFailureClientBehavior("release-drift")).toBe("refresh-and-reconfirm");
    expect(catalogFailureClientBehavior("catalog-not-ready")).toBe("disable-writes-retry-after");
    expect(catalogFailureClientBehavior("legacy-surface-retired")).toBe("migrate-to-successor-no-retry");
    expect(catalogFailureClientBehaviors.forbidden).toBe("hide-out-of-scope");
  });

  it("rejects binding drafts that still carry a legacy spec identity", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ item: {} }));
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });
    expect(() =>
      client.createBindingDraft(
        "project_1",
        "pbind_01KPROJECT",
        {
          definitionId: "pdef_01KGPIOINT",
          effectiveRevisionId: "drev_01K6",
          targetValue: "1",
          reason: "canonical",
          parameterSpecId: "spec-1"
        } as never,
        { catalogReleaseId: "crel_01K42", idempotencyKey: "key-1" }
      )
    ).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks up allow-listed legacy identifiers only", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        item: {
          legacyType: "parameter-spec",
          legacyId: "spec-sc8562-gpio-int",
          disposition: "mapped",
          target: {
            kind: "parameter-definition",
            id: "pdef_01KGPIOINT",
            href: "/api/v2/catalog/definitions/pdef_01KGPIOINT"
          },
          historicalOnly: false
        }
      })
    );
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });
    await expect(client.getLegacyIdentifier("parameter-spec", "spec-sc8562-gpio-int")).resolves.toMatchObject({
      item: { disposition: "mapped" }
    });
    expect(() => client.getLegacyIdentifier("unknown-type", "x")).toThrow();
  });
});
