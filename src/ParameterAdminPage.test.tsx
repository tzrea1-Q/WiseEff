import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    withdrawSubmissionRound: vi.fn().mockResolvedValue(undefined),
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

function renderPage(
  search = "",
  state = initialState,
  dispatch = vi.fn(),
  parameterActions?: ParameterPageActions,
  onNavigate = vi.fn(),
  runtimeMode: "api" | "mock" = "mock"
) {
  return render(
    <TopBarActionsHarness>
      <ParameterAdminPage
        state={state}
        dispatch={dispatch}
        onNavigate={onNavigate}
        search={search}
        parameterActions={parameterActions}
        runtimeMode={runtimeMode}
      />
    </TopBarActionsHarness>
  );
}

describe("ParameterAdminPage", () => {
  it("renders topbar actions without a dedicated page header", () => {
    renderPage();

    expect(document.querySelector(".param-admin-header")).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "参数管理后台页面操作" })).toBeInTheDocument();
  });

  it("renders the parameter library table with action buttons", () => {
    renderPage();

    const library = screen.getByRole("region", { name: "项目共享参数库" });
    expect(within(library).getByRole("table")).toBeInTheDocument();
    expect(within(library).getByText(/fast_charge_current_limit_ma/)).toBeInTheDocument();
    expect(within(library).getAllByRole("button", { name: "修改" }).length).toBeGreaterThan(0);
    expect(within(library).getAllByRole("button", { name: "项目参数" }).length).toBeGreaterThan(0);
  });

  it("shows an empty library in API mode when runtime parameters are empty", () => {
    renderPage(
      "",
      {
        ...initialState,
        parameters: [],
        configDraft: {
          ...initialState.configDraft,
          projects: [],
          parameterLibrary: initialState.configDraft.parameterLibrary
        }
      },
      vi.fn(),
      createParameterActions(),
      vi.fn(),
      "api"
    );

    expect(screen.getByText("还没有任何参数。从下方开始")).toBeInTheDocument();
    expect(screen.queryByText(/fast_charge_current_limit_ma/)).not.toBeInTheDocument();
  });

  it("opens definition and values dialogs from row actions", () => {
    renderPage();
    const library = screen.getByRole("region", { name: "项目共享参数库" });

    fireEvent.click(within(library).getAllByRole("button", { name: "修改" })[0]);
    expect(screen.getByRole("dialog", { name: /修改参数定义/ })).toBeInTheDocument();
    expect(screen.getByLabelText("参数名")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    fireEvent.click(within(library).getAllByRole("button", { name: "项目参数" })[0]);
    expect(screen.getByRole("dialog", { name: /修改项目参数值/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "项目参数值矩阵" })).toBeInTheDocument();
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
    expect(within(toolbar).queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
    expect(within(toolbar).queryByRole("button", { name: /保存到 JSON/ })).not.toBeInTheDocument();
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

  it("navigates to audit center when audit button is clicked", () => {
    const onNavigate = vi.fn();
    renderPage("", initialState, vi.fn(), undefined, onNavigate);

    fireEvent.click(screen.getByRole("button", { name: /审计/ }));

    expect(onNavigate).toHaveBeenCalledWith(
      `/audit?app=parameter&projectId=${encodeURIComponent(initialState.activeProjectId)}`
    );
  });

  it("redirects legacy audit=open query to audit center", () => {
    const onNavigate = vi.fn();
    renderPage("audit=open", initialState, vi.fn(), undefined, onNavigate);

    expect(onNavigate).toHaveBeenCalledWith(
      `/audit?app=parameter&projectId=${encodeURIComponent(initialState.activeProjectId)}`
    );
  });

  it("opens module management dialog from the library heading", () => {
    renderPage("", initialState, vi.fn());

    fireEvent.click(screen.getByRole("button", { name: "模块管理" }));

    expect(screen.getByRole("dialog", { name: "模块管理" })).toBeInTheDocument();
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

  it("opens the batch import wizard from the toolbar button", () => {
    renderPage();
    const toolbar = screen.getByRole("toolbar", { name: "参数管理后台页面操作" });

    fireEvent.click(within(toolbar).getByRole("button", { name: /批量参数导入/ }));

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("目标项目")).toHaveValue(initialState.activeProjectId);
    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeDisabled();
  });
});
