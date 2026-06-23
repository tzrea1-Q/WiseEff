import { describe, expect, it, vi } from "vitest";

import type { DebugAdminParameterDraft } from "@/domain/debugging/types";
import { createDebuggingAdminClient } from "./debuggingAdminClient";

function createApiClientMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn()
  };
}

const adminParameterDto = {
  id: "param-1",
  projectId: null,
  name: "Fast charge current",
  key: "debug.fast_charge.current",
  description: "Parameter",
  module: "Charging",
  nodePath: "/legacy/current",
  accessMode: "RW",
  unit: "mA",
  range: "0-5000",
  minValue: 0,
  maxValue: 5000,
  risk: "High",
  currentValue: "3000",
  targetValue: "3000",
  sortOrder: 10,
  enabled: true,
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
  selectedBinding: {
    protocol: "adb",
    nodePath: "/sys/adb/current",
    accessMode: "RO",
    enabled: true
  },
  bindings: [
    { protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: false, notes: null },
    { protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: true, isSmokeDefault: true }
  ]
} as const;

const draft: DebugAdminParameterDraft = {
  projectId: null,
  name: "Created",
  key: "debug.created",
  description: "",
  module: "Diagnostics",
  currentValue: "",
  targetValue: "",
  unit: "",
  range: "",
  minValue: undefined,
  maxValue: 100,
  risk: "Low",
  nodePath: "/sys/created",
  accessMode: "RO",
  sortOrder: 1,
  enabled: true,
  bindings: [
    {
      protocol: "hdc",
      nodePath: "/sys/created",
      accessMode: "RO",
      enabled: true,
      isSmokeDefault: true,
      notes: "Smoke path"
    }
  ]
};

describe("debugging admin client", () => {
  it("lists admin parameters with includeArchived and maps bindings", async () => {
    const apiClient = createApiClientMock();
    apiClient.get.mockResolvedValue({ items: [adminParameterDto] });
    const client = createDebuggingAdminClient(apiClient as never);

    const items = await client.listParameters({ includeArchived: true, coverage: "missing-hdc" });

    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/parameters?coverage=missing-hdc&includeArchived=true");
    expect(items[0]).toMatchObject({
      id: "param-1",
      enabled: true,
      archivedAt: null,
      sortOrder: 10,
      selectedProtocol: "adb",
      nodePath: "/sys/adb/current",
      accessMode: "RO",
      bindings: [
        expect.objectContaining({ protocol: "hdc", notes: undefined }),
        expect.objectContaining({ protocol: "adb", isSmokeDefault: true })
      ]
    });
  });

  it("creates parameters with a write DTO", async () => {
    const apiClient = createApiClientMock();
    apiClient.post.mockResolvedValue({ item: { ...adminParameterDto, id: "param-created", bindings: [] } });
    const client = createDebuggingAdminClient(apiClient as never);

    await client.createParameter(draft);

    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/v1/debugging/admin/parameters",
      expect.objectContaining({
        projectId: null,
        key: "debug.created",
        nodePath: "/sys/created",
        accessMode: "RO",
        minValue: null,
        maxValue: 100,
        enabled: true,
        sortOrder: 1,
        bindings: [
          {
            protocol: "hdc",
            nodePath: "/sys/created",
            accessMode: "RO",
            enabled: true,
            notes: "Smoke path"
          }
        ]
      })
    );
  });

  it("updates parameters through the encoded PATCH route with a write DTO", async () => {
    const apiClient = createApiClientMock();
    apiClient.patch.mockResolvedValue({ item: { ...adminParameterDto, name: "Updated" } });
    const client = createDebuggingAdminClient(apiClient as never);

    await client.updateParameter("param/1", { ...draft, name: "Updated", sortOrder: 2 });

    expect(apiClient.patch).toHaveBeenCalledWith(
      "/api/v1/debugging/admin/parameters/param%2F1",
      expect.objectContaining({
        name: "Updated",
        sortOrder: 2,
        bindings: [
          {
            protocol: "hdc",
            nodePath: "/sys/created",
            accessMode: "RO",
            enabled: true,
            notes: "Smoke path"
          }
        ]
      })
    );
  });

  it("sanitizes partial PATCH bindings before sending them", async () => {
    const apiClient = createApiClientMock();
    apiClient.patch.mockResolvedValue({ item: adminParameterDto });
    const client = createDebuggingAdminClient(apiClient as never);

    await client.updateParameter("param-1", {
      bindings: [
        {
          protocol: "adb",
          nodePath: "/sys/adb",
          accessMode: "RO",
          enabled: true,
          isSmokeDefault: true,
          notes: "x"
        }
      ]
    } as never);

    expect(apiClient.patch).toHaveBeenCalledWith("/api/v1/debugging/admin/parameters/param-1", {
      bindings: [
        {
          protocol: "adb",
          nodePath: "/sys/adb",
          accessMode: "RO",
          enabled: true,
          notes: "x"
        }
      ]
    });
  });

  it("upserts bindings and archives parameters or bindings through admin routes", async () => {
    const apiClient = createApiClientMock();
    apiClient.put.mockResolvedValue({ item: { protocol: "hdc", nodePath: "/sys/created", accessMode: "RO", enabled: true } });
    apiClient.post
      .mockResolvedValueOnce({ item: { ...adminParameterDto, enabled: false, archivedAt: "2026-06-22T00:00:00.000Z" } })
      .mockResolvedValueOnce({ item: { ...adminParameterDto, archivedAt: null } })
      .mockResolvedValueOnce({ item: { protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RW", enabled: false } });
    const client = createDebuggingAdminClient(apiClient as never);

    await client.upsertBinding("param-created", "hdc", {
      nodePath: "/sys/created",
      accessMode: "RO",
      enabled: true,
      isSmokeDefault: true,
      notes: "Smoke path"
    } as never);
    await client.archiveParameter("param-created", "Deprecated");
    await client.restoreParameter("param-created");
    await client.archiveBinding("param-created", "adb");

    expect(apiClient.put).toHaveBeenCalledWith(
      "/api/v1/debugging/admin/parameters/param-created/bindings/hdc",
      {
        nodePath: "/sys/created",
        accessMode: "RO",
        enabled: true,
        notes: "Smoke path"
      }
    );
    expect(apiClient.post).toHaveBeenNthCalledWith(1, "/api/v1/debugging/admin/parameters/param-created/archive", {
      reason: "Deprecated"
    });
    expect(apiClient.post).toHaveBeenNthCalledWith(2, "/api/v1/debugging/admin/parameters/param-created/restore", {});
    expect(apiClient.post).toHaveBeenNthCalledWith(
      3,
      "/api/v1/debugging/admin/parameters/param-created/bindings/adb/archive",
      {}
    );
  });
});
