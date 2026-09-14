import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { createDebuggingAdminClient } from "./debuggingAdminClient";

function createApiClientMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
  };
}

describe("debugging admin client", () => {
  it("exposes only node-catalog administration, not legacy parameter administration", () => {
    const client = createDebuggingAdminClient(createApiClientMock() as never);
    type LegacyParameterAdminMethod =
      | "listParameters"
      | "createParameter"
      | "updateParameter"
      | "archiveParameter"
      | "restoreParameter"
      | "upsertBinding"
      | "archiveBinding";
    type ExposedLegacyMethod = Extract<keyof typeof client, LegacyParameterAdminMethod>;

    expectTypeOf<ExposedLegacyMethod>().toEqualTypeOf<never>();
    for (const method of [
      "listParameters",
      "createParameter",
      "updateParameter",
      "archiveParameter",
      "restoreParameter",
      "upsertBinding",
      "archiveBinding"
    ]) {
      expect(client).not.toHaveProperty(method);
    }
  });

  it("lists the logical-node catalog through the node administration interface", async () => {
    const apiClient = createApiClientMock();
    apiClient.get.mockResolvedValue({
      items: [
        {
          id: "node-1",
          organizationId: "org-1",
          name: "Cycle count",
          description: "Battery cycle count",
          module: "Battery",
          enabled: true,
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
          bindings: [{ protocol: "hdc", nodePath: "/sys/hdc/cycles", accessMode: "RO", enabled: true }]
        }
      ]
    });
    const client = createDebuggingAdminClient(apiClient as never);

    await expect(client.listNodes({ includeArchived: true })).resolves.toEqual([
      expect.objectContaining({
        id: "node-1",
        name: "Cycle count",
        bindings: [expect.objectContaining({ protocol: "hdc", nodePath: "/sys/hdc/cycles" })]
      })
    ]);
    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/nodes?includeArchived=true");
  });

  it("deletes a logical node through the guarded admin endpoint", async () => {
    const apiClient = createApiClientMock();
    apiClient.delete.mockResolvedValue(undefined);
    const client = createDebuggingAdminClient(apiClient as never);

    await expect(client.deleteNode("node/1")).resolves.toBeUndefined();
    expect(apiClient.delete).toHaveBeenCalledWith("/api/v1/debugging/admin/nodes/node%2F1");
  });

  it("exports the full v2 catalog document and returns its counts", async () => {
    const apiClient = createApiClientMock();
    const exported = {
      document: {
        format: "wiseeff.debug-node-catalog.v2" as const,
        source: { organizationId: "org-1", organizationName: "ChargeLab", exportedAt: "2026-01-01T00:00:00.000Z" },
        counts: { modules: 1, nodes: 1, bindings: 1 },
        modules: [{ name: "Battery", parentNamePath: [] }],
        nodes: [{ sourceId: "node-1", name: "Cycle count", moduleNamePath: ["Battery"], bindings: [] }]
      },
      counts: { modules: 1, nodes: 1, bindings: 1 },
      organizationId: "org-1",
      fileBytes: 512
    };
    apiClient.get.mockResolvedValue({ item: exported });
    const client = createDebuggingAdminClient(apiClient as never);

    await expect(client.exportCatalog()).resolves.toEqual(exported);
    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/catalog/export?includeArchived=true");
  });

  it("previews an import and only then applies it with the server digest", async () => {
    const apiClient = createApiClientMock();
    const document = {
      format: "wiseeff.debug-node-catalog.v1" as const,
      modules: [{ name: "Battery", parentNamePath: [] }],
      nodes: [{ name: "Cycle count", moduleNamePath: ["Battery"], bindings: [] }]
    };
    const preview = {
      canSubmit: true,
      previewDigest: "digest-1",
      format: "wiseeff.debug-node-catalog.v1",
      sourceOrganization: null,
      targetOrganizationId: "org-1",
      fileCounts: { modules: 1, nodes: 1, bindings: 0 },
      declaredCounts: null,
      modules: { created: 1, updated: 0, unchanged: 0 },
      nodes: { created: 1, updated: 0, unchanged: 0 },
      bindings: { created: 0, updated: 0, unchanged: 0 },
      details: [],
      detailsTruncated: false,
      conflicts: [],
      countConflicts: [],
      warnings: []
    };
    const summary = {
      modulesCreated: 1,
      modulesUpdated: 0,
      modulesUnchanged: 0,
      nodesCreated: 1,
      nodesUpdated: 0,
      nodesUnchanged: 0,
      bindingsCreated: 0,
      bindingsUpdated: 0,
      bindingsUnchanged: 0
    };
    apiClient.post.mockResolvedValueOnce({ item: preview }).mockResolvedValueOnce({ item: summary });
    const client = createDebuggingAdminClient(apiClient as never);

    await expect(client.previewCatalogImport(document)).resolves.toEqual(preview);
    await expect(client.importCatalog(document, "digest-1")).resolves.toEqual(summary);
    expect(apiClient.post).toHaveBeenNthCalledWith(1, "/api/v1/debugging/admin/catalog/import-preview", document);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, "/api/v1/debugging/admin/catalog/import", {
      document,
      previewDigest: "digest-1"
    });
  });
});
