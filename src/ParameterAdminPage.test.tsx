import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { TopBarActionsContext } from "./components/layout";
import { ParameterAdminPage } from "./ParameterAdminPage";
import { initialState } from "./mockData";
import type { ParameterPageActions } from "./app/routes";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/parameter-admin");
});

function TopBarActionsHarness({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null);
  const setStableActions = useCallback((nextActions: ReactNode | null | ((current: ReactNode | null) => ReactNode | null)) => {
    setActions(nextActions);
  }, []);
  const contextValue = useMemo(() => ({ setActions: setStableActions }), [setStableActions]);

  return (
    <TopBarActionsContext.Provider value={contextValue}>
      <header className="topbar">
        <div className="topbar-page-actions" role="toolbar" aria-label="参数管理后台页面操作">
          {actions}
        </div>
      </header>
      {children}
    </TopBarActionsContext.Provider>
  );
}

function createParameterActions(overrides: Partial<ParameterPageActions> = {}): ParameterPageActions {
  return {
    getParameter: vi.fn().mockResolvedValue(initialState.parameters[0]),
    submitChanges: vi.fn().mockResolvedValue(undefined),
    stashChanges: vi.fn().mockResolvedValue(undefined),
    discardDrafts: vi.fn().mockResolvedValue(undefined),
    reviewChange: vi.fn().mockResolvedValue(undefined),
    createImportPreview: vi.fn().mockResolvedValue({
      id: "api-import-batch",
      projectId: initialState.activeProjectId,
      sourceName: "paste.json",
      status: "previewed",
      createdAt: "2026-05-25T08:00:00.000Z",
      summary: { added: 1, updated: 2, unchanged: 3, conflict: 4, highRisk: 1 },
      items: [
        {
          id: "preview-item-1",
          name: "api_import_limit",
          module: "Charging Policy",
          risk: "High",
          unit: "mA",
          range: "0 - 5000",
          currentValue: "3200",
          recommendedValue: "3400",
          description: "API import row",
          classification: "added",
          riskFlag: true
        },
        {
          id: "preview-item-2",
          name: "api_import_voltage",
          module: "Charging Policy",
          risk: "Medium",
          unit: "mV",
          range: "3000 - 4500",
          currentValue: "4100",
          recommendedValue: "4200",
          classification: "updated",
          riskFlag: false
        }
      ]
    }),
    applyImportBatch: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function renderPage(search = "", state = initialState, dispatch = vi.fn(), parameterActions?: ParameterPageActions) {
  return render(
    <TopBarActionsHarness>
      <ParameterAdminPage
        state={state}
        dispatch={dispatch}
        onNavigate={vi.fn()}
        search={search}
        parameterActions={parameterActions}
      />
    </TopBarActionsHarness>
  );
}

function buildDirtyState() {
  return {
    ...initialState,
    configDraft: {
      ...initialState.configDraft,
      parameterLibrary: [
        { ...initialState.configDraft.parameterLibrary[0], description: "changed" },
        ...initialState.configDraft.parameterLibrary.slice(1)
      ]
    }
  };
}

describe("ParameterAdminPage", () => {
  it("renders topbar actions without a dedicated page header", () => {
    renderPage();

    expect(document.querySelector(".param-admin-header")).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "参数管理后台页面操作" })).toBeInTheDocument();
  });

  it("renders at least one parameter list item", () => {
    renderPage();

    const library = screen.getByRole("region", { name: "项目共享参数库" });
    expect(within(library).getAllByRole("button", { name: /fast_charge|charge_voltage|battery/ }).length).toBeGreaterThan(0);
  });

  it("renders a single page heading", () => {
    renderPage();

    expect(screen.queryByRole("heading", { level: 1, name: /项目参数管理后台/ })).not.toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "参数管理后台页面操作" })).toHaveTextContent("批量参数导入");
  });

  it("renders the header action placeholders", () => {
    renderPage();
    const toolbar = screen.getByRole("toolbar", { name: "参数管理后台页面操作" });

    expect(within(toolbar).getByRole("button", { name: /批量参数导入/ })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /导出/ })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /权限/ })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /审计/ })).toBeInTheDocument();
  });

  it("renders five KPI strip items", () => {
    renderPage();
    const strip = screen.getByRole("region", { name: "参数管理后台指标" });

    expect(within(strip).getByText("共享参数")).toBeInTheDocument();
    expect(within(strip).getByText("高风险")).toBeInTheDocument();
    expect(within(strip).getByText("闲置参数")).toBeInTheDocument();
    expect(within(strip).getByText("最近导入")).toBeInTheDocument();
  });

  it("reflects audit drawer state on the shell", () => {
    renderPage("audit=open");

    expect(document.querySelector(".param-admin-shell")?.getAttribute("data-audit")).toBe("open");
    expect(screen.getByRole("complementary", { name: "审计抽屉" })).toBeInTheDocument();
  });

  it("shows a dirty indicator after config diverges from the last export", () => {
    const { rerender } = renderPage();

    expect(screen.queryByText(/未导出/)).toBeNull();

    rerender(
      <TopBarActionsHarness>
        <ParameterAdminPage state={buildDirtyState()} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />
      </TopBarActionsHarness>
    );

    expect(screen.getByText(/1 处未导出/)).toBeInTheDocument();
  });

  it("opens a diff dialog from the export menu and confirms MARK_EXPORTED", () => {
    const dispatch = vi.fn();
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:parameter-admin");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    renderPage("", buildDirtyState(), dispatch);

    const toolbar = screen.getByRole("toolbar", { name: "参数管理后台页面操作" });

    fireEvent.click(within(toolbar).getByRole("button", { name: /导出 JSON/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /下载/ }));

    expect(screen.getByRole("dialog", { name: "导出 JSON 快照" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /确认导出/ }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "MARK_EXPORTED" }));
    expect(createObjectUrl).toHaveBeenCalled();
  });

  it("opens delete confirmation and dispatches DELETE_PROJECT_PARAMETER", () => {
    const dispatch = vi.fn();
    const parameter = initialState.configDraft.parameterLibrary[0];
    renderPage("", initialState, dispatch);

    fireEvent.click(screen.getByRole("button", { name: `删除 ${parameter.name}` }));

    expect(screen.getByRole("dialog", { name: /删除参数/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /确认删除/ }));

    expect(dispatch).toHaveBeenCalledWith({ type: "DELETE_PROJECT_PARAMETER", parameterId: parameter.id });
  });

  it("shows undo toast when an undo stack entry exists", () => {
    const dispatch = vi.fn();
    const undoState = {
      ...initialState,
      _undoStack: {
        id: "u1",
        actionKind: "parameter-delete" as const,
        message: "已删除 x",
        snapshot: {},
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
        originalAuditEventId: "ae-x"
      }
    };

    renderPage("", undoState, dispatch);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("已删除 x")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /撤销/ }));

    expect(dispatch).toHaveBeenCalledWith({ type: "UNDO_LAST_DESTRUCTIVE" });
  });

  it("previews and applies a parameter import through parameterActions", async () => {
    const parameterActions = createParameterActions();
    renderPage("", initialState, vi.fn(), parameterActions);
    const toolbar = screen.getByRole("toolbar", { name: "参数管理后台页面操作" });

    fireEvent.click(within(toolbar).getByRole("button", { name: /批量参数导入/ }));
    const dialog = screen.getByRole("dialog", { name: "参数导入" });
    fireEvent.change(within(dialog).getByLabelText("粘贴导入内容"), {
      target: {
        value: JSON.stringify([
          {
            name: "api_import_limit",
            module: "Charging Policy",
            risk: "High",
            unit: "mA",
            range: "0 - 5000",
            currentValue: "3200",
            recommendedValue: "3400",
            description: "API import row"
          }
        ])
      }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "生成预览" }));

    await waitFor(() => expect(parameterActions.createImportPreview).toHaveBeenCalledWith({
      projectId: initialState.activeProjectId,
      sourceName: "pasted-import.json",
      items: [
        expect.objectContaining({
          name: "api_import_limit",
          module: "Charging Policy",
          risk: "High"
        })
      ]
    }));
    expect(within(dialog).getByText("新增 1")).toBeInTheDocument();
    expect(within(dialog).getByText("更新 2")).toBeInTheDocument();
    expect(within(dialog).getByText("不变 3")).toBeInTheDocument();
    expect(within(dialog).getByText("冲突 4")).toBeInTheDocument();
    expect(within(dialog).getByText("高风险 1")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "应用导入" }));

    await waitFor(() => expect(parameterActions.applyImportBatch).toHaveBeenCalledWith({
      batchId: "api-import-batch",
      selectedItemIds: ["preview-item-1", "preview-item-2"]
    }));
  });

  it("prevents applying an import preview when all preview items are deselected", async () => {
    const parameterActions = createParameterActions();
    renderPage("", initialState, vi.fn(), parameterActions);

    fireEvent.click(screen.getByRole("button", { name: /批量参数导入/ }));
    const dialog = screen.getByRole("dialog", { name: "参数导入" });
    fireEvent.change(within(dialog).getByLabelText("粘贴导入内容"), {
      target: {
        value: JSON.stringify([
          {
            name: "api_import_limit",
            module: "Charging Policy",
            risk: "High",
            unit: "mA",
            range: "0 - 5000",
            currentValue: "3200"
          }
        ])
      }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "生成预览" }));

    await waitFor(() => expect(parameterActions.createImportPreview).toHaveBeenCalledTimes(1));
    within(dialog).getAllByRole("checkbox").forEach((checkbox) => {
      fireEvent.click(checkbox);
    });

    const applyButton = within(dialog).getByRole("button", { name: "应用导入" });
    expect(applyButton).toBeDisabled();
    fireEvent.click(applyButton);

    expect(parameterActions.applyImportBatch).not.toHaveBeenCalled();
  });

  it("preselects only eligible import preview items", async () => {
    const parameterActions = createParameterActions({
      createImportPreview: vi.fn().mockResolvedValue({
        id: "api-import-batch",
        projectId: initialState.activeProjectId,
        sourceName: "paste.json",
        status: "previewed",
        createdAt: "2026-05-25T08:00:00.000Z",
        summary: { added: 1, updated: 1, unchanged: 1, conflict: 1, highRisk: 0 },
        items: [
          {
            id: "preview-added",
            name: "api_added_limit",
            module: "Charging Policy",
            risk: "Medium",
            unit: "mA",
            range: "0 - 5000",
            currentValue: "3200",
            classification: "added"
          },
          {
            id: "preview-updated",
            name: "api_updated_limit",
            module: "Charging Policy",
            risk: "Medium",
            unit: "mA",
            range: "0 - 5000",
            currentValue: "3300",
            classification: "updated"
          },
          {
            id: "preview-unchanged",
            name: "api_unchanged_limit",
            module: "Charging Policy",
            risk: "Low",
            unit: "mA",
            range: "0 - 5000",
            currentValue: "3400",
            classification: "unchanged"
          },
          {
            id: "preview-conflict",
            name: "api_conflict_limit",
            module: "Charging Policy",
            risk: "High",
            unit: "mA",
            range: "0 - 5000",
            currentValue: "3500",
            classification: "conflict"
          }
        ]
      })
    });
    renderPage("", initialState, vi.fn(), parameterActions);

    fireEvent.click(screen.getByRole("button", { name: /批量参数导入/ }));
    const dialog = screen.getByRole("dialog", { name: "参数导入" });
    fireEvent.change(within(dialog).getByLabelText("粘贴导入内容"), {
      target: {
        value: JSON.stringify([
          {
            name: "api_added_limit",
            module: "Charging Policy",
            risk: "Medium",
            unit: "mA",
            range: "0 - 5000",
            currentValue: "3200"
          }
        ])
      }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "生成预览" }));

    await waitFor(() => expect(parameterActions.createImportPreview).toHaveBeenCalledTimes(1));
    const checkboxes = within(dialog).getAllByRole("checkbox");
    expect(checkboxes.map((checkbox) => (checkbox as HTMLInputElement).checked)).toEqual([true, true, false, false]);
    expect(checkboxes.map((checkbox) => (checkbox as HTMLInputElement).disabled)).toEqual([false, false, true, true]);
    expect(within(dialog).getByText("added")).toBeInTheDocument();
    expect(within(dialog).getByText("updated")).toBeInTheDocument();
    expect(within(dialog).getByText("unchanged · not eligible")).toBeInTheDocument();
    expect(within(dialog).getByText("conflict · not eligible")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "应用导入" }));

    await waitFor(() =>
      expect(parameterActions.applyImportBatch).toHaveBeenCalledWith({
        batchId: "api-import-batch",
        selectedItemIds: ["preview-added", "preview-updated"]
      })
    );
  });
});
