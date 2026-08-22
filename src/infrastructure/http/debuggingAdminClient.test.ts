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

  it("exports the debug node catalog and imports a v1 document", async () => {
    const apiClient = createApiClientMock();
    const document = {
      format: "wiseeff.debug-node-catalog.v1" as const,
      modules: [{ name: "Battery", parentNamePath: [] }],
      nodes: [{ name: "Cycle count", moduleNamePath: ["Battery"], bindings: [] }]
    };
    const summary = { modulesCreated: 1, modulesUpdated: 0, nodesCreated: 1, nodesUpdated: 0, bindingsUpserted: 0 };
    apiClient.get.mockResolvedValue({ item: document });
    apiClient.post.mockResolvedValue({ item: summary });
    const client = createDebuggingAdminClient(apiClient as never);

    await expect(client.exportCatalog()).resolves.toEqual(document);
    await expect(client.importCatalog(document)).resolves.toEqual(summary);
    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/catalog/export?includeArchived=true");
    expect(apiClient.post).toHaveBeenCalledWith("/api/v1/debugging/admin/catalog/import", document);
  });
});
