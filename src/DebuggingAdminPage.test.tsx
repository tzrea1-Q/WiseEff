import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBarActionsContext } from "@/components/layout";
import { DebuggingAdminPage } from "./DebuggingAdminPage";
import { createDebuggingAdminClient } from "./infrastructure/http/debuggingAdminClient";
import { initialState } from "./mockData";

const adminState = { ...initialState, activeRoleId: "admin" };

function createDebuggingAdminApiMock() {
  const seedNode = {
    id: "node-1",
    projectId: "aurora",
    name: "Fast charge current",
    description: "Fast charge node",
    detailedDescription: "Controls constant charge current.",
    module: "Battery Charging",
    enabled: true,
    bindings: [{ protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: true }]
  };

  return {
    seedNode,
    get: vi.fn().mockImplementation((path: string) => {
      if (path === "/api/v1/debugging/admin/modules") {
        return Promise.resolve({
          items: [{ name: "Battery Charging", description: "", scope: "" }]
        });
      }
      return Promise.resolve({ items: [seedNode] });
    }),
    post: vi.fn().mockResolvedValue({ item: seedNode }),
    patch: vi.fn().mockImplementation((_path, body) => Promise.resolve({ item: { ...seedNode, ...body } })),
    put: vi.fn().mockImplementation((_path, body) =>
      Promise.resolve({
        item: {
          protocol: "hdc",
          nodePath: body.nodePath,
          accessMode: body.accessMode,
          enabled: body.enabled,
          notes: body.notes ?? null
        }
      })
    )
  };
}

function renderDebuggingAdminPage(apiClient = createDebuggingAdminApiMock()) {
  render(
    <TopBarActionsContext.Provider value={{ setActions: vi.fn() }}>
      <DebuggingAdminPage
        state={adminState}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        search=""
        runtimeMode="api"
        debuggingAdminClient={createDebuggingAdminClient(apiClient as never)}
        apiAuthPermissions={["debugging:admin"]}
      />
    </TopBarActionsContext.Provider>
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
});

describe("/debugging-admin API mode", () => {
  it("loads API node catalog, edits in node dialog, and saves through PATCH", async () => {
    const apiClient = renderDebuggingAdminPage();

    expect(await screen.findByText("Fast charge current")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/nodes?projectId=aurora&includeArchived=true");
    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/modules");
    expect(screen.getByText("Battery Charging")).toBeInTheDocument();

    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Fast charge current edited" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled());
    expect(apiClient.patch.mock.calls[0][0]).toBe("/api/v1/debugging/admin/nodes/node-1");
    expect(apiClient.patch.mock.calls[0][1]).toEqual(expect.objectContaining({ name: "Fast charge current edited" }));
  });

  it("creates a new API catalog node via 新增节点 button", async () => {
    const apiClient = renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(screen.getByRole("button", { name: "新增节点" }));

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Thermal throttle limit" } });
    fireEvent.change(screen.getByLabelText("模块"), { target: { value: "Battery Charging" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/v1/debugging/admin/nodes",
        expect.objectContaining({
          name: "Thermal throttle limit",
          module: "Battery Charging",
          enabled: true,
          projectId: "aurora"
        })
      )
    );
  });

  it("opens module management dialog from the library toolbar", async () => {
    renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(screen.getByRole("button", { name: "模块管理" }));

    expect(screen.getByRole("dialog", { name: "模块管理" })).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "模块管理" });
    expect(within(dialog).getByText("Battery Charging")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "1" })).toBeInTheDocument();
  });

  it("upserts node bindings through the bindings dialog", async () => {
    const apiClient = renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: "路径绑定" }));
    fireEvent.change(screen.getByLabelText("HDC 节点路径"), { target: { value: "/sys/hdc/current-edited" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 HDC binding" }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/api/v1/debugging/admin/nodes/node-1/bindings/hdc", {
        nodePath: "/sys/hdc/current-edited",
        accessMode: "RW",
        enabled: true
      })
    );
  });

  it("blocks invalid node binding saves before calling the API", async () => {
    const apiClient = renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: "路径绑定" }));
    fireEvent.change(screen.getByLabelText("HDC 节点路径"), { target: { value: "relative/path" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 HDC binding" }));

    expect(screen.getByText("节点路径必须以 / 开头。")).toBeInTheDocument();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it("disables nodes through confirmation dialog", async () => {
    const apiClient = renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: /禁用 Fast charge current/ }));
    fireEvent.click(screen.getByRole("button", { name: /^禁用$/ }));

    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith(
        "/api/v1/debugging/admin/nodes/node-1",
        { enabled: false }
      )
    );
  });
});
