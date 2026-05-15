import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { TopBarActionsContext } from "./components/layout";
import { ParameterAdminPage } from "./ParameterAdminPage";
import { initialState } from "./mockData";

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

function renderPage(search = "", state = initialState, dispatch = vi.fn()) {
  return render(
    <TopBarActionsHarness>
      <ParameterAdminPage
        state={state}
        dispatch={dispatch}
        onNavigate={vi.fn()}
        search={search}
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

    expect(screen.getAllByRole("option", { name: /fast_charge|charge_voltage|battery/ }).length).toBeGreaterThan(0);
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
});
