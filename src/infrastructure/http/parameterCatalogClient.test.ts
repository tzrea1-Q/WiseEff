import { describe, expect, it, vi } from "vitest";

import {
  catalogFailureClientBehaviors,
  catalogForbiddenSpoofHeaders,
  parameterCatalogCanonicalRoutes,
  parameterCatalogClientMethodByRouteId
} from "@wiseeff/dto-schemas";
import { WiseEffApiError } from "./apiClient";
import { createApiParameterCatalogGovernanceRepository } from "../../application/parameter-catalog/apiAdapter";
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

describe("protected project Binding client", () => {
  // Observed public JSON row shape, plus a synthetic DTS value codec variant; no database acceptance.
  const binding = {
    id: "pbind_6b6714303ae7c1781f7b56a45ee6dac66b4ef5c935b431ecfb0b81eec78e43f4",
    projectId: "page-8f791044-f5bd-4d31-bc4e-fb0e5734e188", parameterSpecId: "pdef_acme_power_iin_max",
    parameterSpecVersionId: "drev_acme_power_iin_max_1", definitionId: "pdef_acme_power_iin_max",
    effectiveRevisionId: "drev_acme_power_iin_max_1", currentValueId: "pval_590c9cf0634dc079ba3876d18b2114feb507439f053220fc3acb6f647fe9c520",
    propertyKey: "iin_max", driverModule: "Configuration", logicalNodeId: null, instanceName: null, locator: "/limit",
    effectiveValue: { kind: "json", value: 36.5 }, rawValue: "36.5\n", schemaState: "valid", policyState: "not_applicable",
    moduleId: "10b210eb-bb98-413d-9d87-961128adae59", displayName: "Input current limit", description: null,
    documentation: "Maximum accepted input current."
  };
  it.each([
    { kind: "json", value: 36.5 },
    { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "36", value: "36" }]] }
  ])("validates the existing public $kind row and preserves exact current pins", async (effectiveValue) => {
    const body = { items: [{ ...binding, effectiveValue }] };
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    const client = createParameterCatalogClient({ fetchImpl });
    expect(await client.listProtectedProjectBindings(binding.projectId)).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(`/api/v2/projects/${binding.projectId}/parameter-bindings`, expect.objectContaining({ method: "GET" }));
  });
  it("refuses malformed public rows without repairing the payload", async () => {
    const client = createParameterCatalogClient({ fetchImpl: vi.fn(async () => jsonResponse({ items: [{ ...binding, rawValue: 36.5 }] })) });
    await expect(client.listProtectedProjectBindings(binding.projectId)).rejects.toMatchObject({
      code: "INTERNAL_ERROR", details: { reason: "contract-drift", schemaName: "CatalogProtectedProjectBindingListResponse" }
    });
  });
});

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
  it("passes only discovery filters through the port and rejects mixed-release pages", async () => {
    const page = {status:"ready",catalogRelease:{id:"crel_one",digest:"sha256:one"},
      matcherRevision:"matcher-one",items:[],nextCursor:null,ignoredReviewItemCount:null,
      emptyReason:"no-observations"};
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(page));
    const repository = createApiParameterCatalogGovernanceRepository(
      createParameterCatalogClient({fetchImpl:fetchMock}));
    await expect(repository.listDriverCompatibleDiscovery("org_one",{cursor:"obs_before"}))
      .rejects.toMatchObject({code:"VALIDATION_FAILED",details:{reason:"release-pin-required"}});
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(repository.listDriverCompatibleDiscovery("org_one",
      {projectId:"project_one",observationId:"obs_one",cursor:"obs_before",limit:3},
      {id:"crel_one",digest:"sha256:one"})).resolves.toEqual(page);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v2/organizations/org_one/driver-compatible-discovery?projectId=project_one&observationId=obs_one&cursor=obs_before&limit=3");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string,string>)["X-WiseEff-Catalog-Release"])
      .toBe("crel_one");
    await expect(repository.listDriverCompatibleDiscovery("org_one",{cursor:"obs_before"},
      {id:"crel_one",digest:"sha256:different"})).rejects.toMatchObject({
        code:"CONFLICT",details:{reason:"release-drift"}});
    fetchMock.mockImplementationOnce(async () => jsonResponse({status:"unavailable",reason:"review-evidence-invalid"}));
    await expect(repository.listDriverCompatibleDiscovery("org_one")).resolves.toEqual(
      {status:"unavailable",reason:"review-evidence-invalid"});
  });
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

  it("keeps ETag metadata scoped to governance reads that opt in", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(catalogDocument, 200, { ETag: "catalog-release-etag" })
    );
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });

    await expect(client.getCatalog()).resolves.toEqual(catalogDocument);
  });

  it("pins historical catalog reads with catalogReleaseId instead of borrowing current", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(catalogDocument));
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });
    await client.getCatalog({ catalogReleaseId: "crel_historical" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/catalog?catalogReleaseId=crel_historical",
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

  it("preserves the governance placement ETag after envelope validation", async () => {
    const placementItem = {
      id: "placement_01K",
      displayName: "Driver A",
      parentPlacementId: null,
      moduleId: "module_driver_a"
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ item: placementItem, etag: "etag-envelope" })
      )
      .mockResolvedValueOnce(
        jsonResponse({ item: placementItem }, 200, { ETag: "etag-header" })
      );
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });

    await expect(client.getPlacement("org_01K", "registration_01K")).resolves.toEqual({
      item: placementItem,
      etag: "etag-envelope"
    });
    await expect(
      client.updatePlacement(
        "org_01K",
        "registration_01K",
        { placement: { mode: "use-default" }, destinationModuleId: "module_driver_b" },
        { catalogReleaseId: "crel_01K42", idempotencyKey: "key-1", ifMatch: "etag-before" }
      )
    ).resolves.toEqual({ item: placementItem, etag: "etag-header" });

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["If-Match"]).toBe("etag-before");
  });

  it("posts a typed ChangeSet to publication-candidates with the catalog release header", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        item: {
          id: "ccand_01KPAGE",
          expectedBaseReleaseId: "crel_01K42",
          expectedBaseReleaseDigest: "sha256:abc",
          riskClass: "low",
          impactSummary: {
            addedDefinitionCount: 1,
            changedDefinitionCount: 0,
            addedSubjectCount: 0
          },
          capabilityContract: {
            revision: "catalog-capability/v4",
            allowListId: "page-historical-definition-content"
          }
        }
      }, 201)
    );
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });
    await client.createPublicationCandidate(
      {
        changeSet: [
          {
            op: "create-definition",
            subjectId: "csub_acme_power",
            propertyKey: "iin_min",
            content: {
              displayName: "Input min",
              documentation: "Minimum input current.",
              unit: "mA",
              valueSchema: { type: "integer", minimum: 0 }
            }
          }
        ]
      },
      { catalogReleaseId: "crel_01K42" }
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v2/catalog/publication-candidates");
    expect(headers["X-WiseEff-Catalog-Release"]).toBe("crel_01K42");
    expect(JSON.parse(String(init.body))).toMatchObject({
      changeSet: [{ op: "create-definition", propertyKey: "iin_min" }]
    });
  });

  it("publishes with idempotencyKey in the body and reads job currentness", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        item: {
          id: "cjob_01KPAGE",
          candidateId: "ccand_01KPAGE",
          status: "queued",
          attemptCount: 0,
          effective: false,
          isCurrent: false,
          currentness: null,
          failure: null
        }
      }, 201)
    );
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });
    await client.publishPublicationCandidate(
      "ccand_01KPAGE",
      { idempotencyKey: "pub-1" },
      { catalogReleaseId: "crel_01K42" }
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v2/catalog/publication-candidates/ccand_01KPAGE/publish"
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      idempotencyKey: "pub-1"
    });
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

  it("reads the canonical pending-draft list with its reason, and deletes through the canonical route", async () => {
    // Issue #849: the tray used to read and delete through the legacy v1 draft
    // surface, which shares neither the table nor the id space with the canonical
    // drafts it creates. Both directions must address the canonical owner.
    const draft = {
      id: "pvd_01K",
      bindingId: "pbind_01K",
      definitionId: "pdef_01K",
      effectiveRevisionId: "drev_01K",
      currentValueId: "pval_01K",
      targetValue: "2000",
      action: "set",
      sourceFormat: "dts",
      sourcePinId: null,
      candidateId: null,
      baseRevisionId: "base-revision-01K",
      reason: "raise published input current",
      updatedAt: "2026-09-15T00:00:00.000Z"
    };
    const calls: Array<{ method: string; url: string }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ method: init?.method ?? "GET", url: String(input) });
      if ((init?.method ?? "GET") === "DELETE") {
        return jsonResponse({ item: { id: draft.id } });
      }
      return jsonResponse({ items: [draft] });
    });
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });

    const listed = await client.listProjectValueDrafts("project_1");
    expect(listed.items?.[0]?.reason).toBe("raise published input current");
    expect(listed.items?.[0]?.updatedAt).toBe("2026-09-15T00:00:00.000Z");

    await client.deleteProjectValueDraft("project_1", draft.id, {
      catalogReleaseId: "crel_01K42",
      idempotencyKey: "key-1"
    });

    expect(calls.map((call) => `${call.method} ${call.url.replace(/^https?:\/\/[^/]+/, "")}`)).toEqual([
      "GET /api/v2/projects/project_1/parameter-value-drafts",
      `DELETE /api/v2/projects/project_1/parameter-value-drafts/${draft.id}`
    ]);
  });

  it("reads exact pinned-source export without falling back to current files", async () => {
    const exportResponse = {
      item: {
        bindingId: "pbind_01K",
        projectId: "project_1",
        definitionId: "pdef_01K",
        definitionRevisionId: "drev_01K",
        catalogReleaseId: "crel_01K42",
        configRevisionId: "crev_01K",
        currentValueId: "pval_01K",
        valueState: "present",
        configSetId: "cset_01K",
        sourceRef: "source-pin-01K",
        files: [{ name: "config.json", format: "json", versionNumber: 3, content: '{"enabled":true}\n' }],
        manifest: {
          organizationId: "org_01K",
          projectId: "project_1",
          bindingId: "pbind_01K",
          definitionId: "pdef_01K",
          projectValueId: "pval_01K",
          sourcePinId: "spin_01K",
          sourceOccurrenceId: "occ_01K",
          configSetId: "cset_01K",
          configRevisionId: "crev_01K",
          fileId: "file_01K",
          fileVersionId: "fver_01K",
          format: "json",
          valueState: "present",
          baseSourcePinId: null,
          deleteRequestId: null,
          deleteProof: null,
          logicalNodeId: null,
          configurationInstanceId: null,
          configurationSchemaSubjectId: null,
          rootPointer: "/",
          entryFile: "config.json",
          includeSearchPaths: [],
          overlayOrder: [],
          locator: { kind: "json-pointer", pointer: "/charging-policy" },
          members: [{
            memberId: "member_01K",
            fileId: "file_01K",
            fileVersionId: "fver_01K",
            sourceName: "config.json",
            format: "json",
            role: "root",
            sortOrder: 0,
            checksum: "sha256:source",
            sizeBytes: 16
          }]
        }
      }
    };
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(exportResponse));
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });

    await expect(client.getCanonicalBindingExport("project_1", "pbind_01K")).resolves.toEqual(exportResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/projects/project_1/parameter-bindings/pbind_01K/export",
      expect.objectContaining({ method: "GET" })
    );
    await expect(client.getCanonicalBindingExport("project_1", "pbind_01K", "value/history")).resolves.toEqual(exportResponse);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v2/projects/project_1/parameter-bindings/pbind_01K/export?projectValueId=value%2Fhistory",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("loads the frozen source diff through the request-scoped route", async () => {
    const sourceDiff = {
      item: {
        requestId: "request-01K",
        bindingId: "pbind_01K",
        format: "json",
        sourceName: "config.json",
        sourcePinId: "spin_01K",
        candidateId: "cand_01K",
        baseDigest: "sha256:before",
        proposedDigest: "sha256:after",
        diffDigest: "sha256:diff",
        before: '{"enabled":false}\n',
        after: '{"enabled":true}\n',
        bindings: [{
          bindingId: "pbind_01K",
          oldValueId: "pval_old",
          sourcePinId: "spin_01K",
          sourceOccurrenceId: "occ_01K",
          definitionId: "pdef_01K",
          effectiveRevisionId: "drev_01K",
          catalogReleaseId: "crel_01K42",
          locator: { kind: "json-pointer", pointer: "/enabled" },
          valueKind: "json",
          valueDigest: "sha256:after",
          configSetId: "cset_01K"
        }]
      }
    };
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(sourceDiff));
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });

    await expect(client.getProjectValueChangeSourceDiff("project_1", "request-01K")).resolves.toEqual(sourceDiff);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/projects/project_1/parameter-value-change-requests/request-01K/source-diff",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("accepts a null conflict decision for an ordinary request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ item: null }));
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });
    await expect(client.getProjectValueConflictDecision("project-1", "request-1"))
      .resolves.toEqual({ item: null });
  });

  it("reads the frozen conflict decision through the request-scoped route", async () => {
    const sourceDiff = { requestId: "request-1", bindingId: "binding-1", candidateId: "prepared-1",
      format: "json", sourcePinId: "pin-1", baseDigest: "a".repeat(64), proposedDigest: "b".repeat(64),
      diffDigest: "c".repeat(64), before: "old", after: "new" };
    const item = { request: { id: "request-1", bindingId: "binding-1", targetValue: "50",
      sourceFormat: "json", status: "pending", assignedToUserId: "reviewer-1", submitterUserId: "author-1" },
      sourceCandidateId: "uploaded-1", selectedBindingId: "binding-1", selectedDraftId: "draft-1",
      choice: "file", decisionProofDigest: "d".repeat(64), sourceDiff };
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ item }));
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });
    await expect(client.getProjectValueConflictDecision("project/1", "request/1")).resolves.toEqual({ item });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/projects/project%2F1/parameter-value-change-requests/request%2F1/conflict-decision",
      expect.objectContaining({ method: "GET" })
    );
  });

  it.each([
    ["json", "approve"], ["json", "reject"], ["dts", "approve"], ["dts", "reject"]
  ] as const)("parses one ordered %s batch, sends its proof for %s and notifies review/withdrawal", async (format, decision) => {
    const proof = "a".repeat(64);
    const targets = ["binding-a", "binding-b"].map((bindingId, ordinal) => ({
      ordinal, draftId: null, decision: "file", bindingId, definitionId: "definition-1",
      definitionRevisionId: "revision-1", catalogReleaseId: "release-1",
      baseCurrentValueId: `old-${ordinal}`, configRevisionId: `config-${ordinal}`,
      sourceRef: `source-${ordinal}`, sourcePinId: `pin-${ordinal}`,
      action: "set", targetText: String(50 + ordinal), appliedValueId: null,
      appliedHistoryEventId: null, appliedSourcePinId: null, appliedFileVersionId: null
    }));
    const batch = { item: {
      id: "batch-1", projectId: "project-1", candidateId: "candidate-1",
      batchProofDigest: proof, cohortCount: 2, status: "pending", reason: "calibrate",
      draftImpactDigest: proof, draftImpact: targets.map((target) => ({
        ordinal: target.ordinal, bindingId: target.bindingId, role: "target", decision: "file",
        baseCurrentValueId: target.baseCurrentValueId, sourcePinId: target.sourcePinId,
        configRevisionId: target.configRevisionId, drafts: []
      })), uploadCandidateId: null,
      decisionProofDigest: null, compositionProof: null,
      submitterUserId: "author", assignedToUserId: "reviewer", reviewerUserId: null,
      reviewerNote: null, sourceProofToken: "source-proof", cohortProofToken: "cohort-proof",
      fileId: "file-1", baseVersionId: "version-1", configSetId: "set-1",
      appliedAt: null, appliedAuditRef: null, targets
    } };
    const diff = { item: {
      kind: "batch", requestId: "batch-1", candidateId: "candidate-1",
      uploadCandidateId: null, decisionProofDigest: null,
      batchProofDigest: proof, format, sourceName: `config.${format}`,
      baseDigest: "old-digest", proposedDigest: "new-digest", diffDigest: proof,
      before: '{"a":1}', after: '{"a":2}',
      bindings: targets.map((target) => ({
        bindingId: target.bindingId, oldValueId: target.baseCurrentValueId,
        sourcePinId: target.sourcePinId, sourceOccurrenceId: `occ-${target.ordinal}`,
        definitionId: target.definitionId, effectiveRevisionId: target.definitionRevisionId,
        catalogReleaseId: target.catalogReleaseId, locator: { kind: "json-pointer", pointer: `/item/${target.ordinal}` },
        valueKind: "json", valueDigest: "value-digest", configSetId: "set-1"
      })),
      targets: targets.map((target) => ({ ordinal: target.ordinal, bindingId: target.bindingId,
        sourcePinId: target.sourcePinId, action: target.action, beforeText: "1", afterText: target.targetText,
        decision: "file", draftId: null }))
    } };
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const path = String(url);
      if (path.endsWith("/source-diff")) return jsonResponse(diff);
      if (path.endsWith("/review")) return jsonResponse({ item: { ...batch.item, status: decision === "approve" ? "approved" : "rejected" } });
      if (path.endsWith("/withdraw")) return jsonResponse({ item: { ...batch.item, status: "withdrawn" } });
      if (path.includes("/batches") && init?.method === "GET") return jsonResponse({ items: [batch.item] });
      return jsonResponse(batch, init?.method === "POST" && path.endsWith("/batches") ? 201 : 200);
    });
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });

    await expect(client.getProjectValueBatchChangeRequest("project-1", "batch-1")).resolves.toEqual(batch);
    await expect(client.submitProjectValueBatchChangeRequest("project-1", {
      candidateId: "candidate-1", expectedProofToken: "preview-proof", reason: "calibrate", assignedToUserId: "reviewer"
    }, { catalogReleaseId: "release-1", idempotencyKey: "submit-1" })).resolves.toEqual(batch);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/projects/project-1/parameter-value-change-requests/batches",
      expect.objectContaining({ method: "POST", body: JSON.stringify({
        candidateId: "candidate-1", expectedProofToken: "preview-proof", reason: "calibrate", assignedToUserId: "reviewer"
      }) })
    );
    await expect(client.listProjectValueBatchChangeRequests("project-1", { status: "pending", mine: true }))
      .resolves.toEqual({ items: [batch.item] });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/projects/project-1/parameter-value-change-requests/batches?status=pending&mine=true",
      expect.objectContaining({ method: "GET" })
    );
    await expect(client.getProjectValueChangeSourceDiff("project-1", "batch-1")).resolves.toEqual(diff);
    const changed = vi.fn();
    window.addEventListener("wiseeff:canonical-requests-changed", changed);
    await expect(client.reviewProjectValueChangeRequest("project-1", "batch-1",
      { decision, batchProofDigest: proof },
      { catalogReleaseId: "release-1", idempotencyKey: "review-1" })).resolves.toEqual({
        item: { ...batch.item, status: decision === "approve" ? "approved" : "rejected" }
      });
    const [url, options] = fetchMock.mock.lastCall!;
    expect(url).toBe("/api/v2/projects/project-1/parameter-value-change-requests/batch-1/review");
    expect(options).toEqual(expect.objectContaining({ method: "POST", body: JSON.stringify({ decision, batchProofDigest: proof }) }));
    await expect(client.withdrawProjectValueChangeRequest("project-1", "batch-1",
      { catalogReleaseId: "release-1", idempotencyKey: "withdraw-1" }))
      .resolves.toEqual({ item: { ...batch.item, status: "withdrawn" } });
    window.removeEventListener("wiseeff:canonical-requests-changed", changed);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed.mock.calls[0]![0].detail).toEqual({ projectId: "project-1" });
    expect(changed.mock.calls[1]![0].detail).toEqual({ projectId: "project-1" });
  });

  it.each(["http", "contract", "network"])("does not notify a canonical request change on %s failure", async (failure) => {
    const client = createParameterCatalogClient({ fetchImpl: vi.fn(async () => {
      if (failure === "network") throw new Error("Network unavailable");
      return failure === "http"
        ? jsonResponse({ code: "CONFLICT", message: "Stale review" }, 409)
        : jsonResponse({ item: {} });
    }) });
    const changed = vi.fn();
    window.addEventListener("wiseeff:canonical-requests-changed", changed);
    try {
      await expect(client.reviewProjectValueChangeRequest("project/1", "request/1", { decision: "reject" },
        { catalogReleaseId: "release", idempotencyKey: "failed-review" })).rejects.toThrow();
      await expect(client.withdrawProjectValueChangeRequest("project/1", "request/1",
        { catalogReleaseId: "release", idempotencyKey: "failed-withdrawal" })).rejects.toThrow();
      expect(changed).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("wiseeff:canonical-requests-changed", changed);
    }
  });

  it("sends the pending-review filter without the Catalog list whitelist dropping it", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ items: [] }));
    const client = createParameterCatalogClient({ baseUrl: "",fetchImpl: fetchMock });
    await client.listProjectValueChangeRequests("project_1",{ status: "pending" });
    expect(fetchMock).toHaveBeenCalledWith("/api/v2/projects/project_1/parameter-value-change-requests?status=pending",expect.objectContaining({ method: "GET" }));
    await client.listProjectValueChangeRequests("project_1", { status: "rejected", mine: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/v2/projects/project_1/parameter-value-change-requests?status=rejected&mine=true", expect.objectContaining({ method: "GET" }));
  });

  it.each(["approve", "reject"] as const)("carries the exact frozen member-removal proof through %s and notifies review/withdrawal", async (decision) => {
    const proofDigest = "a".repeat(64);
    const member = (fileId: string) => ({ fileId, fileVersionId: `v-${fileId}`,
      sourceName: `${fileId}.json`, format: "json", role: "base", sortOrder: 0,
      checksum: "sha256:source", sizeBytes: 12 });
    const cohort = (bindingId: string) => ({ bindingId, oldValueId: `v-${bindingId}`,
      sourcePinId: `pin-${bindingId}`, sourceOccurrenceId: `occ-${bindingId}`,
      definitionId: "def", effectiveRevisionId: "rev", catalogReleaseId: "release",
      fileId: "file-a", fileVersionId: "v-file-a", locator: { pointer: "/value" },
      valueDigest: "sha256:value" });
    const item = { id: "request-1", projectId: "project-1", configSetId: "set-1",
      fileId: "file-a", fileVersionId: "v-file-a", proofDigest,
      frozenProof: { kind: "canonical-member-removal", organizationId: "org-1",
        projectId: "project-1", configSetId: "set-1", fileId: "file-a",
        fileVersionId: "v-file-a", configRevisionId: "config-rev",
        members: [member("file-a"), member("file-b")],
        cohort: [cohort("binding-a"), cohort("binding-b")], proofDigest },
      status: "pending", reason: "retire member", submitterUserId: "submitter",
      assignedToUserId: "reviewer", reviewerUserId: null, reviewerNote: null,
      appliedSourceResult: null, createdAt: "2026-09-24T00:00:00Z",
      updatedAt: "2026-09-24T00:00:00Z" };
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/review")) return jsonResponse({ item: { ...item, status: decision === "approve" ? "approved" : "rejected" } });
      if (String(url).endsWith("/withdraw")) return jsonResponse({ item: { ...item, status: "withdrawn" } });
      return jsonResponse({ item });
    });
    const client = createParameterCatalogClient({ baseUrl: "", fetchImpl: fetchMock });
    const context = { catalogReleaseId: "release", idempotencyKey: "member-key" };
    const submitted = await client.submitMemberRemovalRequest("project-1", {
      configSetId: "set-1", fileId: "file-a", reason: "retire member",
      assignedToUserId: "reviewer"
    }, context);
    expect(submitted.item.frozenProof).toEqual(item.frozenProof);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v2/projects/project-1/parameter-value-change-requests/member-removals"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      fileId: "file-a", assignedToUserId: "reviewer"
    });
    await expect(client.getMemberRemovalRequest("project-1", "request-1")).resolves.toEqual({ item });
    const changed = vi.fn();
    window.addEventListener("wiseeff:canonical-requests-changed", changed);
    try {
      await expect(client.reviewMemberRemovalRequest("project-1", "request-1", {
        decision, memberProofDigest: submitted.item.proofDigest
      }, context)).resolves.toMatchObject({ item: { status: decision === "approve" ? "approved" : "rejected" } });
      await expect(client.withdrawMemberRemovalRequest("project-1", "request-1", context)).resolves.toMatchObject({ item: { status: "withdrawn" } });
      expect(changed).toHaveBeenCalledTimes(2);
      expect(changed.mock.calls.map(([event]) => event.detail)).toEqual([
        { projectId: "project-1" }, { projectId: "project-1" }
      ]);
    } finally {
      window.removeEventListener("wiseeff:canonical-requests-changed", changed);
    }
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      decision, memberProofDigest: proofDigest
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "/api/v2/projects/project-1/parameter-value-change-requests/request-1/review"
    );
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
