import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createDebuggingAdminClient } from "./infrastructure/http/debuggingAdminClient";
import { initialState } from "./mockData";

const adminState = { ...initialState, activeRoleId: "admin" };

function createResolvedAdminAuthClient() {
  return {
    getCurrentAuthContext: vi.fn().mockResolvedValue({
      user: {
        id: "admin-api",
        organizationId: "org-api",
        name: "API Admin",
        username: "api.admin",
        title: "Admin",
        isActive: true
      },
      organization: { id: "org-api", name: "API Org" },
      roles: [{ projectId: null, roleId: "admin" }],
      permissions: ["debugging:view", "debugging:admin", "admin:access"]
    })
  };
}

function createDebuggingAdminApiMock() {
  const seedParameter = {
    id: "param-1",
    projectId: null,
    name: "Fast charge current",
    key: "debug.fast_charge.current",
    description: "Parameter",
    module: "Charging",
    nodePath: "/sys/current",
    accessMode: "RW",
    unit: "mA",
    range: "0-5000",
    risk: "High",
    currentValue: "3000",
    targetValue: "3000",
    sortOrder: 10,
    enabled: true,
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    bindings: [
      { protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: true },
      { protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: true }
    ]
  };

  return {
    seedParameter,
    get: vi.fn().mockResolvedValue({ items: [seedParameter] }),
    post: vi.fn().mockResolvedValue({ item: seedParameter }),
    patch: vi.fn().mockImplementation((_path, body) => Promise.resolve({ item: { ...seedParameter, ...body } })),
    put: vi.fn()
  };
}

function renderDebuggingAdminPage(apiClient = createDebuggingAdminApiMock()) {
  render(
    <App
      authClient={createResolvedAdminAuthClient()}
      debuggingAdminClient={createDebuggingAdminClient(apiClient as never)}
      initialAppState={adminState}
      runtimeMode="api"
    />
  );
  return apiClient;
}

function findTableRowByText(text: string) {
  const row = screen.getByText(text).closest("tr");
  if (!row) {
    throw new Error(`找不到行: ${text}`);
  }
  return row;
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("/debugging-admin API mode", () => {
  it("loads API catalog parameters, edits in definition dialog, and saves through PATCH", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = renderDebuggingAdminPage();

    expect(await screen.findByText("Fast charge current")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/parameters?includeArchived=true");
    expect(screen.getByText("双协议")).toBeInTheDocument();

    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: "修改" }));
    fireEvent.change(screen.getByLabelText("参数名称"), { target: { value: "Fast charge current edited" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled());
    expect(apiClient.patch.mock.calls[0][0]).toBe("/api/v1/debugging/admin/parameters/param-1");
    expect(apiClient.patch.mock.calls[0][1]).toEqual(expect.objectContaining({ name: "Fast charge current edited" }));
    expect(apiClient.patch.mock.calls[0][1].bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: true }),
        expect.objectContaining({ protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: true })
      ])
    );
  });

  it("creates a new API catalog parameter via 新增参数 button", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(screen.getByRole("button", { name: "新增参数" }));

    fireEvent.change(screen.getByLabelText("参数名称"), { target: { value: "Thermal throttle limit" } });
    fireEvent.change(screen.getByLabelText("参数 key"), { target: { value: "debug.thermal.throttle_limit" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/v1/debugging/admin/parameters",
        expect.objectContaining({
          key: "debug.thermal.throttle_limit",
          name: "Thermal throttle limit"
        })
      )
    );
    expect(apiClient.post.mock.calls.some(([path]) => path === "/api/v1/debugging/admin/parameters/param-1/archive")).toBe(false);
  });

  it("treats disabled API parameters as inactive instead of archived", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = createDebuggingAdminApiMock();
    apiClient.get.mockResolvedValue({
      items: [{
        ...apiClient.seedParameter,
        enabled: false,
        archivedAt: null
      }]
    });
    renderDebuggingAdminPage(apiClient);

    expect(await screen.findByText("Fast charge current")).toBeInTheDocument();
    expect(screen.queryByText("已归档")).not.toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /归档 Fast charge current/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复参数" })).not.toBeInTheDocument();
  });

  it("opens 路径绑定 dialog and saves/archives protocol bindings", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = createDebuggingAdminApiMock();
    apiClient.put.mockResolvedValue({
      item: { protocol: "hdc", nodePath: "/sys/hdc/current_edited", accessMode: "RW", enabled: true, notes: "saved" }
    });
    apiClient.post.mockResolvedValue({
      item: { protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: false, notes: "archived" }
    });
    renderDebuggingAdminPage(apiClient);

    await screen.findByText("Fast charge current");
    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: "路径绑定" }));
    fireEvent.change(screen.getByLabelText("HDC 节点路径"), { target: { value: "/sys/hdc/current_edited" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 HDC binding" }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith(
        "/api/v1/debugging/admin/parameters/param-1/bindings/hdc",
        expect.objectContaining({ nodePath: "/sys/hdc/current_edited", accessMode: "RW", enabled: true })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "归档 ADB binding" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/v1/debugging/admin/parameters/param-1/bindings/adb/archive",
        {}
      )
    );
  });

  it("archives parameters through confirmation dialog", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = createDebuggingAdminApiMock();
    apiClient.post.mockResolvedValue({
      item: {
        ...apiClient.seedParameter,
        enabled: false,
        archivedAt: "2026-06-22T12:00:00.000Z",
        archivedBy: "admin-api",
        archiveReason: "Archived from debugging admin."
      }
    });
    renderDebuggingAdminPage(apiClient);

    await screen.findByText("Fast charge current");
    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: /归档 Fast charge current/ }));
    fireEvent.click(screen.getByRole("button", { name: /^归档$/ }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/v1/debugging/admin/parameters/param-1/archive",
        { reason: "Archived from debugging admin." }
      )
    );
  });
});
