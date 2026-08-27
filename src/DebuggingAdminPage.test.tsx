import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBarActionsContext } from "@/components/layout";
import { DebuggingAdminPage } from "./DebuggingAdminPage";
import { WiseEffApiError } from "./infrastructure/http/apiClient";
import { createDebuggingAdminClient } from "./infrastructure/http/debuggingAdminClient";
import { initialState } from "./mockData";

const adminState = { ...initialState, activeRoleId: "admin" };

function createDebuggingAdminApiMock() {
  const seedNode = {
    id: "node-1",
    name: "Fast charge current",
    description: "Fast charge node",
    detailedDescription: "Controls constant charge current.",
    writeFormatExample: "3100",
    writeFormatHint: "输入毫安值，例如 3100。",
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
      if (path.startsWith("/api/v1/debugging/admin/catalog/export")) {
        return Promise.resolve({
          item: { format: "wiseeff.debug-node-catalog.v1", modules: [], nodes: [seedNode] }
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
    ),
    delete: vi.fn().mockResolvedValue(undefined)
  };
}

function renderDebuggingAdminPage(apiClient = createDebuggingAdminApiMock(), apiAuthPermissions = ["debugging:admin"]) {
  render(
    <TopBarActionsContext.Provider value={{ setActions: vi.fn() }}>
      <DebuggingAdminPage
        state={adminState}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        search=""
        area="nodes"
        runtimeMode="api"
        debuggingAdminClient={createDebuggingAdminClient(apiClient as never)}
        apiAuthPermissions={apiAuthPermissions}
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
  it("switches scope peers between parameter reload config and node catalog", async () => {
    const onNavigate = vi.fn();
    render(
      <TopBarActionsContext.Provider value={{ setActions: vi.fn() }}>
        <DebuggingAdminPage
          state={adminState}
          dispatch={vi.fn()}
          onNavigate={onNavigate}
          search=""
          area="parameter"
          runtimeMode="api"
          debuggingAdminClient={createDebuggingAdminClient(createDebuggingAdminApiMock() as never)}
          apiAuthPermissions={["debugging:admin"]}
        />
      </TopBarActionsContext.Provider>
    );

    const scopeNav = screen.getByRole("navigation", { name: "调试后台范围" });
    expect(within(scopeNav).getByRole("button", { name: "参数调试" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("main", { name: "参数调试" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "可调节点目录" })).not.toBeInTheDocument();

    fireEvent.click(within(scopeNav).getByRole("button", { name: "节点调试" }));
    expect(onNavigate).toHaveBeenCalledWith("/debugging-admin/nodes");
  });

  it("loads API node catalog, edits in node dialog, and saves through PATCH", async () => {
    const apiClient = renderDebuggingAdminPage();

    expect(await screen.findByText("Fast charge current")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/nodes?includeArchived=true");
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
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/v1/debugging/admin/nodes",
        expect.objectContaining({
          name: "Thermal throttle limit",
          module: "Battery Charging",
          moduleId: "legacy:Battery Charging",
          enabled: true
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

  it("opens module moves in a dedicated dialog", async () => {
    renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(screen.getByRole("button", { name: "模块管理" }));
    const moduleDialog = screen.getByRole("dialog", { name: "模块管理" });
    fireEvent.click(within(moduleDialog).getByRole("button", { name: "Battery Charging 更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "移动" }));

    const moveDialog = screen.getByRole("dialog", { name: "移动「Battery Charging」" });
    expect(moveDialog).toBeInTheDocument();
    expect(within(moveDialog).getByText("当前位置：Battery Charging")).toBeInTheDocument();
    expect(screen.queryByText("移动模块「Battery Charging」到：")).not.toBeInTheDocument();
  });

  it("opens node deletion confirmation from a module detail entry", async () => {
    const apiClient = renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(screen.getByRole("button", { name: "模块管理" }));
    const moduleDialog = screen.getByRole("dialog", { name: "模块管理" });
    fireEvent.click(within(moduleDialog).getByRole("button", { name: "1" }));

    const nodeEntry = within(moduleDialog).getByText("Fast charge current").closest("li");
    if (!nodeEntry) {
      throw new Error("找不到模块详情中的节点条目");
    }
    fireEvent.click(within(nodeEntry).getByRole("button", { name: "删除节点" }));

    const confirmation = screen.getByRole("dialog", { name: "永久删除节点 Fast charge current" });
    expect(confirmation).toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole("button", { name: "删除节点" }));

    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/api/v1/debugging/admin/nodes/node-1"));
  });

  it("disables module detail deletion for read-only API users", async () => {
    renderDebuggingAdminPage(createDebuggingAdminApiMock(), []);

    await screen.findByText("Fast charge current");
    fireEvent.click(screen.getByRole("button", { name: "模块管理" }));
    const moduleDialog = screen.getByRole("dialog", { name: "模块管理" });
    fireEvent.click(within(moduleDialog).getByRole("button", { name: "1" }));

    const nodeEntry = within(moduleDialog).getByText("Fast charge current").closest("li");
    if (!nodeEntry) {
      throw new Error("找不到模块详情中的节点条目");
    }
    const deleteButton = within(nodeEntry).getByRole("button", { name: "删除节点" });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute("title", "缺少 debugging:admin 权限");
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
    const hdcPathInput = screen.getByLabelText("HDC 节点路径");
    fireEvent.change(hdcPathInput, { target: { value: "relative/path" } });
    fireEvent.blur(hdcPathInput);
    fireEvent.click(screen.getByRole("button", { name: "保存 HDC binding" }));

    expect(screen.getByText("节点路径必须以 / 开头。")).toBeInTheDocument();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it("exports the node catalog from the library heading", async () => {
    const apiClient = renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(screen.getByRole("button", { name: "导出目录" }));

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/catalog/export?includeArchived=true")
    );
  });

  it("imports a catalog JSON file through the hidden file input", async () => {
    const apiClient = renderDebuggingAdminPage();
    apiClient.post.mockResolvedValue({
      item: { modulesCreated: 0, modulesUpdated: 0, nodesCreated: 1, nodesUpdated: 0, bindingsUpserted: 0 }
    });
    const document = { format: "wiseeff.debug-node-catalog.v1", modules: [], nodes: [] };

    await screen.findByText("Fast charge current");
    const fileInput = screen.getByLabelText("导入目录文件") as HTMLInputElement;
    const file = {
      name: "debug-node-catalog.json",
      type: "application/json",
      text: async () => JSON.stringify(document)
    } as File;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/api/v1/debugging/admin/catalog/import", document)
    );
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

  it("deletes an unused node after explicit confirmation and removes it from the catalog", async () => {
    const apiClient = renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: /删除 Fast charge current/ }));

    expect(screen.getByRole("dialog", { name: /永久删除节点/ })).toBeInTheDocument();
    expect(screen.getByText(/同时删除该节点的 HDC \/ ADB 路径绑定/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除节点" }));

    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/api/v1/debugging/admin/nodes/node-1"));
    await waitFor(() => expect(screen.queryByText("Fast charge current")).not.toBeInTheDocument());
    expect(screen.getByText("节点已删除")).toBeInTheDocument();
  });

  it("does not submit the same deletion twice while the request is pending", async () => {
    const apiClient = renderDebuggingAdminPage();
    let resolveDelete: (() => void) | undefined;
    apiClient.delete.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveDelete = resolve;
      })
    );

    await screen.findByText("Fast charge current");
    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: /删除 Fast charge current/ }));
    const confirmButton = screen.getByRole("button", { name: "删除节点" });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(apiClient.delete).toHaveBeenCalledTimes(1);
    resolveDelete?.();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /永久删除节点/ })).not.toBeInTheDocument());
  });

  it("refreshes the catalog when a concurrent deletion returns not found", async () => {
    const apiClient = renderDebuggingAdminPage();
    apiClient.delete.mockRejectedValueOnce(new WiseEffApiError("NOT_FOUND", "Debug node was not found.", {}, "request-delete"));
    apiClient.get.mockImplementation((path: string) => {
      if (path === "/api/v1/debugging/admin/modules") {
        return Promise.resolve({ items: [{ name: "Battery Charging", description: "", scope: "" }] });
      }
      return Promise.resolve({ items: [] });
    });

    await screen.findByText("Fast charge current");
    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: /删除 Fast charge current/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除节点" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /永久删除节点/ })).not.toBeInTheDocument());
    expect(screen.queryByText("Fast charge current")).not.toBeInTheDocument();
    expect(screen.getByText("节点已不存在，列表已刷新")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/nodes?includeArchived=true");
  });

  it("keeps the node and confirmation dialog open when operation history protects deletion", async () => {
    const apiClient = renderDebuggingAdminPage();
    apiClient.delete.mockRejectedValueOnce(
      new WiseEffApiError(
        "CONFLICT",
        "Debug node has historical operations and cannot be deleted; disable it instead.",
        { nodeId: "node-1", reason: "node-history-protection", operationCount: 2 },
        "request-delete"
      )
    );

    await screen.findByText("Fast charge current");
    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: /删除 Fast charge current/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除节点" }));

    expect(await screen.findByText("节点存在 2 条调试历史记录，无法永久删除，请改用禁用。")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: /永久删除节点/ });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName("永久删除节点 Fast charge current");
    expect(dialog).toHaveAccessibleDescription(/无法永久删除，请改用禁用/);
  });

  it("converges mock deletion with the shared debug-parameter state", async () => {
    const dispatch = vi.fn();
    const node = adminState.configDraft.debugParameters[0]!;
    render(
      <TopBarActionsContext.Provider value={{ setActions: vi.fn() }}>
        <DebuggingAdminPage
          state={adminState}
          dispatch={dispatch}
          onNavigate={vi.fn()}
          search=""
          area="nodes"
          runtimeMode="mock"
        />
      </TopBarActionsContext.Provider>
    );

    const row = await screen.findByRole("row", { name: new RegExp(node.name) });
    fireEvent.click(within(row).getByRole("button", { name: new RegExp(`删除 ${node.name}`) }));
    fireEvent.click(screen.getByRole("button", { name: "删除节点" }));

    expect(dispatch).toHaveBeenCalledWith({ type: "DELETE_DEBUG_PARAMETER", parameterId: node.id });
    await waitFor(() => expect(screen.queryByRole("row", { name: new RegExp(node.name) })).not.toBeInTheDocument());
  });
});
