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
          item: {
            document: {
              format: "wiseeff.debug-node-catalog.v2",
              source: { organizationId: "org-chargelab", organizationName: "ChargeLab" },
              counts: { modules: 1, nodes: 1, bindings: 1 },
              modules: [{ name: "Battery Charging", parentNamePath: [] }],
              nodes: [
                {
                  sourceId: "node-1",
                  name: "Fast charge current",
                  moduleNamePath: ["Battery Charging"],
                  bindings: [{ protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: true }]
                }
              ]
            },
            counts: { modules: 1, nodes: 1, bindings: 1 },
            organizationId: "org-chargelab",
            fileBytes: 512
          }
        });
      }
      return Promise.resolve({ items: [seedNode] });
    }),
    post: vi.fn().mockResolvedValue({ item: seedNode }),
    patch: vi.fn().mockImplementation((_path, body) => Promise.resolve({ item: { ...seedNode, ...body } })),
    put: vi.fn().mockImplementation((path, body) =>
      Promise.resolve({
        item: {
          protocol: path.endsWith("/adb") ? "adb" : "hdc",
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

  it("prevents deleting an API module referenced by a legacy name-only node", async () => {
    const apiClient = createDebuggingAdminApiMock();
    let moduleListCallCount = 0;
    apiClient.get.mockImplementation((path: string) => {
      if (path === "/api/v1/debugging/admin/modules") {
        moduleListCallCount += 1;
        return Promise.resolve({
          items: [{ id: "dm-battery", name: "Battery Charging", description: "", scope: "", parentId: null, path: "dm-battery", depth: 0 }]
        });
      }
      return Promise.resolve({ items: [apiClient.seedNode] });
    });

    renderDebuggingAdminPage(apiClient);
    await waitFor(() => expect(moduleListCallCount).toBe(1));

    const moduleHeader = await screen.findByRole("columnheader", { name: /模块/ });
    const filterButton = within(moduleHeader).getByRole("button", { name: "筛选模块", expanded: false });
    fireEvent.click(filterButton);
    expect(screen.getByRole("checkbox", { name: "Battery Charging" })).toBeInTheDocument();
    fireEvent.click(within(moduleHeader).getByRole("button", { name: "筛选模块", expanded: true }));

    fireEvent.click(screen.getByRole("button", { name: "模块管理" }));
    const dialog = screen.getByRole("dialog", { name: "模块管理" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Battery Charging 更多操作" }));
    const deleteModule = screen.getByRole("menuitem", { name: "删除" });
    expect(deleteModule).toBeDisabled();
    expect(deleteModule).toHaveAttribute("title", "仍有子模块或节点引用，无法删除");
    expect(apiClient.delete).not.toHaveBeenCalled();
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

  it("preserves an unsaved sibling protocol draft after saving one binding", async () => {
    const apiClient = renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: "路径绑定" }));
    fireEvent.change(screen.getByLabelText("HDC 节点路径"), { target: { value: "/sys/hdc/current-edited" } });
    fireEvent.change(screen.getByLabelText("ADB 节点路径"), { target: { value: "/sys/adb/current-edited" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 HDC binding" }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/api/v1/debugging/admin/nodes/node-1/bindings/hdc", {
        nodePath: "/sys/hdc/current-edited",
        accessMode: "RW",
        enabled: true
      })
    );
    expect(screen.getByLabelText("ADB 节点路径")).toHaveValue("/sys/adb/current-edited");

    fireEvent.click(screen.getByRole("button", { name: "保存 ADB binding" }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenNthCalledWith(2, "/api/v1/debugging/admin/nodes/node-1/bindings/adb", {
        nodePath: "/sys/adb/current-edited",
        accessMode: "RO",
        enabled: false,
        notes: ""
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

  it("exports the full node catalog from the library heading", async () => {
    const apiClient = renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    fireEvent.click(screen.getByRole("button", { name: "导出全部节点" }));

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/catalog/export?includeArchived=true")
    );
    expect(await screen.findByText(/已导出全部节点：节点 1，模块 1，绑定 1/)).toBeInTheDocument();
  });

  it("previews an imported file and only writes after explicit confirmation", async () => {
    const apiClient = renderDebuggingAdminPage();
    const importDocument = {
      format: "wiseeff.debug-node-catalog.v2",
      source: { organizationId: "org-source", organizationName: "Source Org" },
      counts: { modules: 0, nodes: 1, bindings: 1 },
      modules: [],
      nodes: [
        {
          sourceId: "source-node",
          name: "Imported node",
          moduleNamePath: [],
          bindings: [
            { protocol: "hdc", nodePath: "/sys/hdc/imported", accessMode: "RW", enabled: true },
            { protocol: "adb", nodePath: "/sys/adb/imported", accessMode: "RO", enabled: false }
          ]
        }
      ]
    };
    apiClient.post.mockImplementation((path: string) => {
      if (path.endsWith("/import-preview")) {
        return Promise.resolve({
          item: {
            canSubmit: true,
            previewDigest: "digest-1",
            format: "wiseeff.debug-node-catalog.v2",
            sourceOrganization: { organizationId: "org-source", organizationName: "Source Org" },
            targetOrganizationId: "org-chargelab",
            fileCounts: { modules: 0, nodes: 1, bindings: 2 },
            declaredCounts: { modules: 0, nodes: 1, bindings: 2 },
            modules: { created: 0, updated: 0, unchanged: 0 },
            nodes: { created: 1, updated: 0, unchanged: 0 },
            bindings: { created: 2, updated: 0, unchanged: 0 },
            details: [
              {
                path: "nodes//Imported node",
                name: "Imported node",
                object: "node",
                classification: "created",
                fields: []
              },
              {
                path: "nodes/[\"\"]::Imported node/bindings/adb",
                name: "adb",
                object: "binding",
                classification: "created",
                fields: []
              }
            ],
            detailsTruncated: false,
            conflicts: [],
            warnings: []
          }
        });
      }
      return Promise.resolve({
        item: {
          modulesCreated: 0,
          modulesUpdated: 0,
          modulesUnchanged: 0,
          nodesCreated: 1,
          nodesUpdated: 0,
          nodesUnchanged: 0,
          bindingsCreated: 2,
          bindingsUpdated: 0,
          bindingsUnchanged: 0
        }
      });
    });

    await screen.findByText("Fast charge current");
    const fileInput = screen.getByLabelText("导入节点文件") as HTMLInputElement;
    const file = {
      name: "debug-node-catalog.json",
      type: "application/json",
      text: async () => JSON.stringify(importDocument)
    } as File;
    fireEvent.change(fileInput, { target: { files: [file] } });

    const dialog = await screen.findByRole("dialog", { name: "导入预览" });
    expect(within(dialog).getByText("Source Org")).toBeInTheDocument();
    const counts = within(dialog).getByRole("list", { name: "导入分类统计" });
    const countText = (classification: string) =>
      counts.querySelector(`[data-classification="${classification}"]`)?.textContent?.replace(/\s+/g, " ").trim();
    expect(countText("created")).toBe("新增 3");
    expect(countText("updated")).toBe("更新 0");
    expect(countText("unchanged")).toBe("不变 0");
    expect(countText("conflict")).toBe("冲突 0");
    expect(apiClient.post).toHaveBeenCalledWith("/api/v1/debugging/admin/catalog/import-preview", importDocument);
    // Preview alone must not write.
    expect(apiClient.post).not.toHaveBeenCalledWith(
      "/api/v1/debugging/admin/catalog/import",
      expect.anything()
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "确认导入" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/api/v1/debugging/admin/catalog/import", {
        document: importDocument,
        previewDigest: "digest-1"
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "导入预览" })).not.toBeInTheDocument());
  });

  it("keeps blocking conflicts unconfirmable and writes nothing", async () => {
    const apiClient = renderDebuggingAdminPage();
    const importDocument = {
      format: "wiseeff.debug-node-catalog.v2",
      source: {},
      counts: { modules: 1, nodes: 1, bindings: 0 },
      modules: [{ name: "Battery" }],
      nodes: [{ name: "Cycle count", moduleNamePath: ["Battery"] }]
    };
    apiClient.post.mockResolvedValue({
      item: {
        canSubmit: false,
        previewDigest: null,
        format: "wiseeff.debug-node-catalog.v2",
        sourceOrganization: null,
        targetOrganizationId: "org-chargelab",
        fileCounts: { modules: 1, nodes: 1, bindings: 0 },
        declaredCounts: { modules: 1, nodes: 1, bindings: 0 },
        modules: { created: 0, updated: 0, unchanged: 1 },
        nodes: { created: 0, updated: 1, unchanged: 0 },
        bindings: { created: 0, updated: 0, unchanged: 0 },
        details: [],
        detailsTruncated: false,
        conflicts: [
          {
            code: "duplicate-target-claim",
            location: "nodes[1]",
            message: "Node \"Cycle count\" resolves to the same target node as nodes[0]."
          }
        ],
        warnings: []
      }
    });

    await screen.findByText("Fast charge current");
    const fileInput = screen.getByLabelText("导入节点文件") as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          {
            name: "conflict.json",
            type: "application/json",
            text: async () => JSON.stringify(importDocument)
          } as File
        ]
      }
    });

    const dialog = await screen.findByRole("dialog", { name: "导入预览" });
    expect(within(dialog).getByText(/阻断冲突/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认导入" })).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalledWith(
      "/api/v1/debugging/admin/catalog/import",
      expect.anything()
    );
  });

  it("reports an invalid JSON file without calling the preview endpoint", async () => {
    const apiClient = renderDebuggingAdminPage();

    await screen.findByText("Fast charge current");
    const fileInput = screen.getByLabelText("导入节点文件") as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          {
            name: "broken.json",
            type: "application/json",
            text: async () => "{ not json"
          } as File
        ]
      }
    });

    const dialog = await screen.findByRole("dialog", { name: "导入预览" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("文件不是有效的 JSON。");
    expect(apiClient.post).not.toHaveBeenCalledWith(
      "/api/v1/debugging/admin/catalog/import-preview",
      expect.anything()
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
    expect(screen.getByText(/全部调试历史记录/)).toBeInTheDocument();
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

  it("keeps the node and confirmation dialog open when deletion fails", async () => {
    const apiClient = renderDebuggingAdminPage();
    apiClient.delete.mockRejectedValueOnce(
      new WiseEffApiError(
        "INTERNAL_ERROR",
        "Debug node deletion failed.",
        { nodeId: "node-1" },
        "request-delete"
      )
    );

    await screen.findByText("Fast charge current");
    fireEvent.click(within(findTableRowByText("Fast charge current")).getByRole("button", { name: /删除 Fast charge current/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除节点" }));

    const dialog = screen.getByRole("dialog", { name: /永久删除节点/ });
    expect(await within(dialog).findByText("永久删除调试节点失败，请稍后重试。")).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName("永久删除节点 Fast charge current");
    expect(dialog).toHaveAccessibleDescription(/全部调试历史记录/);
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
