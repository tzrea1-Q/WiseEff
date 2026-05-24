import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParametersPage } from "./ParametersPage";
import { TopBarActionsContext } from "./components/layout";
import { initialState } from "./mockData";

beforeEach(() => {
  cleanup();
});

describe("ParametersPage read-only access", () => {
  it("renders guest parameter workspace without edit controls when editing is not allowed", () => {
    const dispatch = vi.fn();
    const onNavigate = vi.fn();
    const guestState = { ...initialState, activeRoleId: "guest" };
    const { container } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={guestState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    expect(screen.getByText("只读访问")).toBeVisible();
    expect(container.querySelector(".edit-row-button")).not.toBeInTheDocument();
    expect(container.querySelector(".parameters-bottom-actions")).not.toBeInTheDocument();
  });

  it("does not expose the Agent insight one-click draft action to Guest", () => {
    const dispatch = vi.fn();
    const onNavigate = vi.fn();
    const guestState = { ...initialState, activeRoleId: "guest" };
    render(
      <TopBarActionsHarness>
        <ParametersPage
          state={guestState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    expect(screen.queryByRole("button", { name: /草稿/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("需要 User 角色才能编辑、暂存或提交参数变更。").length)
      .toBeGreaterThan(0);
  });

  it("does not retain a log-linked draft created while read-only after editing becomes available", async () => {
    const dispatch = vi.fn();
    const onNavigate = vi.fn();
    const guestState = { ...initialState, activeRoleId: "guest" };
    const { container, rerender } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={guestState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search={`?logId=${initialState.logs[0].id}`}
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    expect(screen.getByText("只读访问")).toBeVisible();
    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();

    rerender(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit
        />
      </TopBarActionsHarness>
    );

    await waitFor(() => {
      expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    });
  });

  it("clears existing draft state when editing is revoked while mounted", async () => {
    const dispatch = vi.fn();
    const onNavigate = vi.fn();
    const { container, rerender } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit
        />
      </TopBarActionsHarness>
    );
    const editButton = container.querySelector<HTMLButtonElement>(".edit-row-button");
    expect(editButton).not.toBeNull();
    fireEvent.click(editButton!);
    expect(container.querySelector(".parameter-draft-dialog")).toBeInTheDocument();

    rerender(
      <TopBarActionsHarness>
        <ParametersPage
          state={{ ...initialState, activeRoleId: "guest" }}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    expect(screen.getByText("只读访问")).toBeVisible();
    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(container.querySelector(".edit-row-button")).not.toBeInTheDocument();

    rerender(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit
        />
      </TopBarActionsHarness>
    );

    await waitFor(() => {
      expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
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
        <div className="topbar-page-actions" role="toolbar" aria-label="项目参数用户工作台页面操作">
          {actions}
        </div>
      </header>
      {children}
    </TopBarActionsContext.Provider>
  );
}

function renderPage(dispatch = vi.fn(), onNavigate = vi.fn()) {
  const result = render(
    <TopBarActionsHarness>
      <ParametersPage
        state={initialState}
        dispatch={dispatch}
        onNavigate={onNavigate}
        search=""
      />
    </TopBarActionsHarness>
  );

  return { ...result, dispatch, onNavigate };
}

describe("ParametersPage parameter detail modal", () => {
  it("opens the detail modal from a row view action without changing the pathname", () => {
    window.history.pushState({}, "", "/parameters");
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));

    expect(window.location.pathname).toBe("/parameters");
    expect(screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" })).toBeInTheDocument();
  });

  it("shows the parameter definition and every runtime project", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    const dialog = screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" });

    expect(within(dialog).getByRole("region", { name: "参数定义" })).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "跨项目对比" })).toBeInTheDocument();
    ["AUR-Prod", "NEB-RD", "ATL-Intl"].forEach((projectCode) => {
      expect(within(dialog).getAllByText(projectCode).length).toBeGreaterThan(0);
    });
  });

  it("updates the focused delta when the comparison target changes", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    const dialog = screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" });
    expect(within(dialog).getByText("+350 mA (+9.1%)")).toBeInTheDocument();
    expect(within(dialog).getByText("对比 AUR-Prod 与 NEB-RD")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("对比目标项目"), {
      target: { value: "atlas" }
    });

    expect(within(dialog).getByText("-850 mA (-22.1%)")).toBeInTheDocument();
    expect(within(dialog).getByText("对比 AUR-Prod 与 ATL-Intl")).toBeInTheDocument();
  });

  it("adds the viewed parameter to the existing modification draft sheet", () => {
    const { container } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    fireEvent.click(screen.getByRole("button", { name: "加入修改草稿" }));

    expect(container.querySelector(".parameter-draft-dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3200")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "fast_charge_current_limit_ma" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("adds the recommended config from the detail modal to the modification draft", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    fireEvent.click(screen.getByRole("button", { name: "使用推荐配置加入草稿" }));

    const sheet = screen.getByRole("dialog", { name: "修改草稿" });
    expect(within(sheet).getByDisplayValue("3200")).toBeInTheDocument();
    expect(within(sheet).getByDisplayValue("使用推荐配置生成草稿")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "fast_charge_current_limit_ma" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("adds the selected comparison project value from the detail modal to the modification draft", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    const dialog = screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" });
    fireEvent.change(within(dialog).getByLabelText("对比目标项目"), {
      target: { value: "atlas" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "使用该项目配置加入草稿" }));

    const sheet = screen.getByRole("dialog", { name: "修改草稿" });
    expect(within(sheet).getByDisplayValue("3000")).toBeInTheDocument();
    expect(within(sheet).getByDisplayValue("参考 ATL-Intl 项目当前配置生成草稿")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "fast_charge_current_limit_ma" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("reuses an existing draft when viewing the same parameter from the modal", () => {
    const { container } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));

    expect(screen.getByRole("button", { name: "已在草稿中" })).toBeDisabled();
    expect(container.querySelectorAll(".draft-card")).toHaveLength(1);
    expect(screen.getByDisplayValue("3200")).toBeInTheDocument();
  });

  it("closes the stale detail modal on project switch and cannot add the old project parameter to drafts", () => {
    const { container, rerender } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          effectiveProjectId="aurora"
        />
      </TopBarActionsHarness>
    );

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    expect(screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" })).toBeInTheDocument();

    rerender(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          effectiveProjectId="nebula"
        />
      </TopBarActionsHarness>
    );

    expect(screen.queryByRole("dialog", { name: "fast_charge_current_limit_ma" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加入修改草稿" })).not.toBeInTheDocument();
    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
  });

  it("ignores stale log-linked parameters from another project when seeding drafts", () => {
    const { container } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search="?logId=log-active&parameter=nebula-fast-charge-current"
          effectiveProjectId="aurora"
          canEdit
        />
      </TopBarActionsHarness>
    );

    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /提交本轮/ })).not.toBeInTheDocument();
  });

  it("shows initialization-specific disabled reasons when initialization is locked even if canEdit is false", () => {
    render(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          canEdit={false}
          initializationStatus="initialization_pending_review"
        />
      </TopBarActionsHarness>
    );

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    const dialog = screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" });
    const insight = screen.getByRole("status", { name: "Agent 参数洞察" });

    expect(dialog.querySelector(".parameter-detail-disabled-reason")).toHaveTextContent("初始化通过前暂不可提交普通参数变更。");
    expect(within(insight).getByText("初始化通过前暂不可提交普通参数变更。")).toBeInTheDocument();
    expect(screen.getByText("该项目可查看，初始化通过前暂不可提交普通参数变更。")).toBeInTheDocument();
    expect(screen.queryByText("需要 User 角色才能编辑、暂存或提交参数变更。")).not.toBeInTheDocument();
  });

  it("allows read-only users to view details but disables adding to the draft", () => {
    const { container } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={{ ...initialState, activeRoleId: "guest" }}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    const dialog = screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" });

    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入修改草稿" })).toBeDisabled();
    expect(dialog.querySelector(".parameter-detail-disabled-reason")).toHaveTextContent("需要 User 角色才能编辑、暂存或提交参数变更。");
    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
  });

  it("does not render the standalone topbar comparison action", () => {
    const { container } = renderPage();
    const topbar = container.querySelector(".topbar");

    expect(topbar).not.toBeNull();
    expect(within(topbar as HTMLElement).queryByRole("button", { name: /跨项目对比/ })).not.toBeInTheDocument();
  });
});

describe("ParametersPage (抽出后的模块)", () => {
  it("可以从独立模块引入并渲染工作台根节点", () => {
    renderPage();
    expect(screen.getByRole("region", { name: "项目参数用户工作台" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Agent 参数洞察" })).toBeInTheDocument();
    expect(screen.queryByLabelText("参数筛选")).not.toBeInTheDocument();
  });

  it("复用共享模块中的 Excel 单元格转义 helper", () => {
    const source = readFileSync("src/ParametersPage.tsx", "utf8");

    expect(source).toContain("escapeExcelCell");
    expect(source).not.toMatch(/function\s+escapeExcelCell/);
  });

  it("不从 App 模块导入共享 UI 以避免循环依赖", () => {
    const source = readFileSync("src/ParametersPage.tsx", "utf8");

    expect(source).not.toContain('from "./App"');
  });
});

describe("ParametersPage draft edge cases", () => {
  it("renders the draft editor as a centered modal instead of the sheet shell", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "编辑 fast_charge_current_limit_ma" }));

    const dialog = screen.getByRole("dialog", { name: "修改草稿" });
    expect(dialog.querySelector(".parameter-draft-dialog")).toBeInTheDocument();
    expect(dialog.querySelector(".workbench-sheet")).not.toBeInTheDocument();
  });

  it("moves edited rows into the current-round modified table only after submitting the parameter draft", () => {
    renderPage();

    const searchTable = screen.getByRole("region", { name: "检索参数表" });
    expect(within(searchTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本轮已修改参数表" })).not.toBeInTheDocument();

    fireEvent.click(within(searchTable).getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    expect(screen.getByRole("dialog", { name: "修改草稿" })).toBeInTheDocument();
    expect(within(searchTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本轮已修改参数表" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));

    const modifiedTable = screen.getByRole("region", { name: "本轮已修改参数表" });
    expect(within(modifiedTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(searchTable).queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();

    fireEvent.click(within(modifiedTable).getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "移除本项" }));

    expect(screen.queryByRole("region", { name: "本轮已修改参数表" })).not.toBeInTheDocument();
    expect(within(searchTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
  });

  it("does not render a dedicated breadcrumb page header", () => {
    renderPage();

    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(document.querySelector(".page-header")).not.toBeInTheDocument();
  });

  it("uses subtle-style topbar actions with AI audit as the only primary action", () => {
    const { container } = renderPage();
    const topbar = container.querySelector(".topbar");

    expect(topbar).not.toBeNull();
    ["导出 Excel", "历史提交"].forEach((label) => {
      const action = within(topbar as HTMLElement).getByRole("button", { name: label });
      expect(action).toHaveClass("button", "subtle");
    });
    expect(within(topbar as HTMLElement).queryByRole("button", { name: /跨项目对比/ })).not.toBeInTheDocument();

    const primaryActions = Array.from(topbar!.querySelectorAll<HTMLButtonElement>(".button.primary"));
    expect(primaryActions).toHaveLength(1);
    expect(primaryActions[0]).toHaveAccessibleName("AI 巡检");
  });

  it("reopens the Agent insight when AI audit is clicked after dismissal", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "关闭洞察" }));
    expect(screen.queryByRole("status", { name: "Agent 参数洞察" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI 巡检" }));

    expect(screen.getByRole("status", { name: "Agent 参数洞察" })).toBeInTheDocument();
  });

  it("filters to high-risk rows from the Agent insight", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看高风险" }));

    expect(screen.getByRole("button", { name: "筛选重要性" })).toHaveClass("active");
    const table = screen.getByRole("table");
    expect(within(table).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(table).queryByText("battery_temp_target_c")).not.toBeInTheDocument();
  });

  it("keeps search separate while moving module and importance filters into table headers", () => {
    renderPage();

    const searchTable = screen.getByRole("region", { name: "检索参数表" });
    const toolbar = searchTable.querySelector(".parameters-table-toolbar");
    expect(toolbar).not.toBeNull();
    expect(within(toolbar as HTMLElement).getByRole("searchbox", { name: "按名称 / 描述 / 模块搜索" })).toBeInTheDocument();
    expect(within(toolbar as HTMLElement).queryByRole("button", { name: /模块/ })).not.toBeInTheDocument();
    expect(within(toolbar as HTMLElement).queryByRole("button", { name: /重要性/ })).not.toBeInTheDocument();

    const moduleHeader = within(searchTable).getByRole("columnheader", { name: /模块/ });
    fireEvent.click(within(moduleHeader).getByRole("button", { name: "筛选模块" }));
    expect(within(moduleHeader).getByRole("group", { name: "模块筛选" })).toBeInTheDocument();
    fireEvent.click(within(moduleHeader).getByLabelText("Charging Policy"));

    expect(within(searchTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(searchTable).queryByText("battery_temp_target_c")).not.toBeInTheDocument();

    const riskHeader = within(searchTable).getByRole("columnheader", { name: /重要性/ });
    fireEvent.click(within(riskHeader).getByRole("button", { name: "筛选重要性" }));
    expect(within(riskHeader).getByRole("group", { name: "重要性筛选" })).toBeInTheDocument();
  });

  it("adds insight parameters to the draft sheet in one click", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "一键加入草稿" }));

    expect(screen.getByRole("dialog", { name: "修改草稿" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /提交本轮/ })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("参考 Agent 巡检建议（-16.9%）")).toBeInTheDocument();
  });

  it("does not show the old hard-coded timeline inside the draft sheet", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    const sheet = screen.getByRole("dialog");
    expect(within(sheet).queryByText("管理员合入")).not.toBeInTheDocument();
  });

  it("navigates to my submissions from the draft sheet footer", () => {
    const onNavigate = vi.fn();
    renderPage(vi.fn(), onNavigate);
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    fireEvent.click(screen.getByRole("button", { name: "查看我的提交" }));

    expect(onNavigate).toHaveBeenCalledWith("/parameter-submissions");
  });

  it("uses the draft sheet submit-parameter action to keep the item in the modified table", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    const searchTable = screen.getByRole("region", { name: "检索参数表" });
    const footer = container.querySelector<HTMLElement>(".parameter-draft-dialog .parameter-detail-dialog__footer");
    expect(footer).not.toBeNull();
    expect(within(searchTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本轮已修改参数表" })).not.toBeInTheDocument();
    expect(within(footer!).queryByRole("button", { name: /暂存本轮/ })).not.toBeInTheDocument();
    expect(within(footer!).queryByRole("button", { name: /提交本轮/ })).not.toBeInTheDocument();
    expect(container.querySelector(".parameter-draft-dialog")).toBeInTheDocument();
    expect(container.querySelector(".parameter-draft-dialog__body")).toBeInTheDocument();
    expect(container.querySelector(".parameter-draft-dialog__body")).toHaveClass("parameter-draft-dialog__body");

    const submitParameter = within(footer!).getByRole("button", { name: "提交参数" });
    expect(submitParameter).toBeEnabled();
    fireEvent.click(submitParameter);

    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /提交本轮参数/ })).not.toBeInTheDocument();
    const modifiedSection = screen.getByRole("region", { name: "本轮已修改参数区" });
    const modifiedTable = within(modifiedSection).getByRole("region", { name: "本轮已修改参数表" });
    expect(within(modifiedTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(searchTable).queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();
    const modifiedActions = modifiedSection.querySelector<HTMLElement>(".parameters-bottom-actions");
    expect(modifiedActions).toBeInTheDocument();
    expect(within(modifiedActions as HTMLElement).getByRole("button", { name: "提交本轮 (1 项)" })).toBeEnabled();
  });

  it("does not render an editable draft card for a focused unselected row", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getAllByText("charge_voltage_limit_mv")[0]);

    expect(container.querySelector(".parameter-draft-dialog")).toBeInTheDocument();
    expect(container.querySelector(".focused-draft-editor")).not.toBeInTheDocument();
  });

  it("keeps preview closed when any selected draft has a blank target value", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));

    const targetInput = container.querySelector<HTMLTextAreaElement>(".draft-card textarea[aria-label*='目标值']");
    expect(targetInput).not.toBeNull();
    fireEvent.change(targetInput!, { target: { value: "   " } });

    expect(container.querySelector(".parameters-bottom-actions")).not.toBeInTheDocument();
    expect(container.querySelector(".submission-dialog")).not.toBeInTheDocument();
  });

  it("clears every draft from the sheet header", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));

    fireEvent.click(screen.getByRole("button", { name: "全部清空" }));

    expect(screen.queryByRole("dialog", { name: "修改草稿" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /提交本轮/ })).not.toBeInTheDocument();
  });

  it("shows drift explanation in each draft card", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    const sheet = screen.getByRole("dialog", { name: "修改草稿" });
    expect(within(sheet).getByText(/Agent 建议/)).toBeInTheDocument();
    expect(within(sheet).getByText(/当前偏差/)).toBeInTheDocument();
  });

  it("warns when target value is outside the configured range", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    fireEvent.change(screen.getByLabelText("目标值"), { target: { value: "99999" } });

    expect(screen.getByText(/超出 2500 - 4500 mA/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    expect(screen.getAllByRole("button", { name: "提交本轮 (1 项)" })[0]).toBeEnabled();
  });

  it("uses a multiline target value editor in the parameter draft sheet", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    const sheet = screen.getByRole("dialog", { name: "修改草稿" });
    const targetEditor = within(sheet).getByLabelText("目标值");
    const multilineValue = "profile=thermal\nlimit_ma=4200";

    expect(targetEditor.tagName).toBe("TEXTAREA");
    fireEvent.change(targetEditor, { target: { value: multilineValue } });
    expect(targetEditor).toHaveValue(multilineValue);
  });

  it("cleans up selection, drafts, and sheet state after submit", () => {
    const dispatch = vi.fn();
    const { container } = renderPage(dispatch);
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    const reasonInput = container.querySelector<HTMLTextAreaElement>(".draft-card textarea[aria-label*='修改原因']");
    expect(reasonInput).not.toBeNull();
    fireEvent.change(reasonInput!, {
      target: { value: "submit cleanup reason" }
    });

    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getByRole("button", { name: "提交本轮 (1 项)" }));
    const confirmButton = container.querySelector<HTMLButtonElement>(".dialog-actions .button.primary");
    expect(confirmButton).not.toBeNull();
    fireEvent.click(confirmButton!);

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ADD_PARAMETER_SUBMISSION_ROUND",
      items: [
        expect.objectContaining({
          parameterId: initialState.parameters[0].id,
          reason: "submit cleanup reason"
        })
      ]
    }));
    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(container.querySelector(".parameters-bottom-actions")).not.toBeInTheDocument();
  });
});

describe("ParametersPage · 提交契约", () => {
  it("builds preview and submit items from selected draft entries only", () => {
    const source = readFileSync("src/ParametersPage.tsx", "utf8");
    const previewSource = source.match(/const pendingSubmissionItems[\s\S]*?const allSelectedDraftsHaveTargets[\s\S]*?;/)?.[0] ?? "";
    const submitSource = source.match(/const submitRound[\s\S]*?\r?\n  };\r?\n  const previewItems/)?.[0] ?? "";

    expect(previewSource).toContain("const pendingSubmissionItems");
    expect(submitSource).toContain("const submitRound");
    expect(previewSource).not.toContain("?? parameter.recommendedValue");
    expect(previewSource).not.toContain("?? reason");
    expect(submitSource).not.toContain("?? parameter.recommendedValue");
    expect(submitSource).not.toContain("?? reason");
  });

  it("does not let submission round reducer items fall back to a shared action reason", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const roundReducerSource = appSource.match(/case "ADD_PARAMETER_SUBMISSION_ROUND":[\s\S]*?\n    case "WITHDRAW_PARAMETER_SUBMISSION_ROUND":/)?.[0] ?? "";
    const commandSource = readFileSync("src/domain/parameters/commands.ts", "utf8");
    const pageSource = readFileSync("src/ParametersPage.tsx", "utf8");
    const submitSource = pageSource.match(/const submitRound[\s\S]*?\r?\n  };\r?\n  const previewItems/)?.[0] ?? "";

    expect(roundReducerSource).toContain('case "ADD_PARAMETER_SUBMISSION_ROUND":');
    expect(roundReducerSource).toContain("submitParameterRound");
    expect(commandSource).not.toContain("input.reason");
    expect(submitSource).not.toContain("reason });");
  });

  it("未出现本轮已修改参数时，不显示本轮操作按钮", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /提交本轮/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /暂存本轮/ })).not.toBeInTheDocument();
  });

  it("本轮已修改参数下方显示操作按钮，文案变为『提交本轮 (1 项)』并可点", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    const modifiedSection = screen.getByRole("region", { name: "本轮已修改参数区" });
    expect(within(modifiedSection).getByRole("region", { name: "本轮已修改参数表" })).toBeInTheDocument();
    const actions = modifiedSection.querySelector<HTMLElement>(".parameters-bottom-actions");

    expect(actions).toBeInTheDocument();
    expect(within(actions as HTMLElement).getByRole("button", { name: "提交本轮 (1 项)" })).toBeEnabled();
    expect(within(actions as HTMLElement).getByRole("button", { name: "暂存本轮 (1 项)" })).toBeEnabled();
  });

  it("不存在『加入本轮』按钮", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /加入本轮/ })).not.toBeInTheDocument();
  });

  it("点击提交 → 弹出预览对话框，数量等于勾选数", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getAllByRole("button", { name: "提交本轮 (2 项)" })[0]);
    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });
    expect(within(dialog).getAllByText(/→/).length).toBeGreaterThanOrEqual(2);
  });

  it("提交预览保留对话框名称但不显示标题 h2", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getAllByRole("button", { name: "提交本轮 (1 项)" })[0]);

    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "提交本轮参数" })).not.toBeInTheDocument();
    expect(container.querySelector("#submission-preview-title")).not.toBeInTheDocument();
  });

  it("用代码预览布局展示复杂 DTS 参数的提交 diff", () => {
    const { container } = renderPage();
    const dtsRow = screen.getByText("dts_fast_charge_profile_matrix").closest("tr");
    expect(dtsRow).not.toBeNull();
    const editButton = dtsRow!.querySelector<HTMLButtonElement>(".edit-row-button");
    expect(editButton).not.toBeNull();

    fireEvent.click(editButton!);
    const targetEditor = container.querySelector<HTMLTextAreaElement>(".parameter-draft-code-editor");
    expect(targetEditor).not.toBeNull();
    fireEvent.change(targetEditor!, {
      target: {
        value: `fast-charge-profile-matrix =
  "0", "5000", "1500", "40", "entry",
  "1", "9000", "3000", "43", "balanced",
  "2", "12000", "4300", "48", "boost";`
      }
    });
    const submitDraftButton = container.querySelector<HTMLButtonElement>(
      ".parameter-draft-dialog .parameter-detail-dialog__footer .button.primary"
    );
    expect(submitDraftButton).not.toBeNull();
    fireEvent.click(submitDraftButton!);

    const submitRoundButton = container.querySelector<HTMLButtonElement>(".parameters-bottom-actions .button.primary");
    expect(submitRoundButton).not.toBeNull();
    fireEvent.click(submitRoundButton!);

    const dialog = container.querySelector<HTMLElement>(".submission-dialog");
    expect(dialog).not.toBeNull();
    const complexCard = dialog!.querySelector<HTMLElement>(".submission-diff-card--complex");
    expect(complexCard).not.toBeNull();
    expect(complexCard).toHaveTextContent("dts_fast_charge_profile_matrix");
    expect(complexCard!.querySelector(".diff-values")).not.toBeInTheDocument();
    expect(complexCard!.querySelector(".submission-config-format")).not.toBeInTheDocument();
    expect(complexCard!.querySelector(".submission-preview-code-grid")).not.toBeInTheDocument();

    const diff = complexCard!.querySelector<HTMLElement>(".submission-preview-diff");
    expect(diff).toBeInTheDocument();
    expect(diff).toHaveAttribute("role", "list");
    expect(diff!.querySelectorAll(".submission-preview-diff-row")).toHaveLength(5);
    expect(diff!.querySelectorAll(".submission-preview-diff-row[data-kind='equal']").length).toBeGreaterThan(0);
    expect(diff!.querySelectorAll(".submission-preview-diff-row[data-kind='remove']").length).toBeGreaterThan(0);
    expect(diff!.querySelectorAll(".submission-preview-diff-row[data-kind='add']").length).toBeGreaterThan(0);
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='remove'] code")).toHaveTextContent(
      '"2", "11000", "4200", "46", "burst";'
    );
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='add'] code")).toHaveTextContent(
      '"2", "12000", "4300", "48", "boost";'
    );
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='remove'] .submission-preview-diff-row__marker")).toHaveTextContent("-");
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='add'] .submission-preview-diff-row__marker")).toHaveTextContent("+");

    const styles = readFileSync("src/styles.css", "utf8");
    const codeRule = styles.match(/\.submission-preview-diff\s*\{[^}]*\}/)?.[0] ?? "";
    const rowCodeRule = styles.match(/\.submission-preview-diff-row code\s*\{[^}]*\}/)?.[0] ?? "";
    const removeRowRule = styles.match(/\.submission-preview-diff-row\[data-kind="remove"\]\s*\{[^}]*\}/)?.[0] ?? "";
    const addRowRule = styles.match(/\.submission-preview-diff-row\[data-kind="add"\]\s*\{[^}]*\}/)?.[0] ?? "";
    const lineMetaRule =
      styles.match(/\.submission-preview-diff-row__marker,\s*\.submission-preview-diff-row__line-number\s*\{[^}]*\}/)?.[0] ?? "";
    const genericHeadingRuleIndex = /\.submission-diff-card strong,\s*\.submission-diff-card small\s*\{/.exec(styles)?.index ?? -1;
    const complexHeadingRuleIndex =
      Array.from(styles.matchAll(/\.submission-diff-card--complex strong,\s*\.submission-diff-card--complex small\s*\{/g)).at(-1)?.index ??
      -1;
    expect(codeRule).toMatch(/overflow:\s*auto/);
    expect(codeRule).toContain("background: #ffffff;");
    expect(codeRule).toContain("color: #0f172a;");
    expect(removeRowRule).toContain("background: #fff1f2;");
    expect(addRowRule).toContain("background: #ecfdf5;");
    expect(lineMetaRule).toContain("background: #f8fafc;");
    expect(rowCodeRule).toMatch(/white-space:\s*pre/);
    expect(codeRule).toMatch(/word-break:\s*normal/);
    expect(complexHeadingRuleIndex).toBeGreaterThan(genericHeadingRuleIndex);
  });

  it("提交预览要求选择硬件 MDE、软件 MDE 和软件开发，且软件节点可选同一人", () => {
    const dispatch = vi.fn();
    renderPage(dispatch);
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getAllByRole("button", { name: "提交本轮 (1 项)" })[0]);

    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });
    fireEvent.change(within(dialog).getByLabelText("硬件 MDE"), { target: { value: "u-wang-jie" } });
    fireEvent.change(within(dialog).getByLabelText("软件 MDE"), { target: { value: "u-sun-mei" } });
    fireEvent.change(within(dialog).getByLabelText("软件开发"), { target: { value: "u-sun-mei" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认提交" }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ADD_PARAMETER_SUBMISSION_ROUND",
      assignees: {
        hardwareCommitterId: "u-wang-jie",
        softwareCommitterId: "u-sun-mei",
        softwareUserId: "u-sun-mei"
      }
    }));
  });

  it("聚焦未勾选行后再勾选，不会继承上一行的修改原因", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "第一行的专属原因" }
    });

    fireEvent.click(screen.getByText("charge_voltage_limit_mv"));
    expect(screen.queryByLabelText("修改原因")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));
    const reasonInputs = screen.getAllByLabelText(/修改原因/);
    const secondReason = reasonInputs.find((el) => (el as HTMLTextAreaElement).value === "");
    expect(secondReason).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getAllByRole("button", { name: "提交本轮 (2 项)" })[0]);
    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });

    expect(within(dialog).getByText("第一行的专属原因")).toBeInTheDocument();
    expect(within(dialog).getAllByText("第一行的专属原因")).toHaveLength(1);
  });
});

describe("ParametersPage · 布局与 Sheet", () => {
  it("默认未选行时，不渲染草稿 Sheet", () => {
    renderPage();
    expect(screen.queryByRole("dialog", { name: "修改草稿" })).not.toBeInTheDocument();
  });

  it("编辑后打开 Sheet 并展示该参数的草稿卡片", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    const sheet = screen.getByRole("dialog", { name: "修改草稿" });
    expect(sheet).toBeInTheDocument();
    expect(within(sheet).getByText("本轮提交 1 项")).toBeInTheDocument();
  });

  it("点击 Sheet 关闭按钮后 Sheet 消失，再次编辑可重新打开", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));
    expect(screen.queryByRole("dialog", { name: "修改草稿" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));
    expect(screen.getByRole("dialog", { name: "修改草稿" })).toBeInTheDocument();
    expect(screen.getByText("本轮提交 2 项")).toBeInTheDocument();
  });

  it("再次编辑其他参数时将当前点击的参数置于草稿弹窗首位", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));

    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));

    const firstDraftCard = container.querySelector<HTMLElement>(".parameter-draft-card");
    expect(firstDraftCard).toHaveTextContent("charge_voltage_limit_mv");
    expect(firstDraftCard).not.toHaveTextContent("fast_charge_current_limit_ma");
  });

  it("removing the last draft item clears selection and closes the sheet", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "移除本项" }));

    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(container.querySelector(".parameters-bottom-actions")).not.toBeInTheDocument();
  });

  it("bottom actions stay hidden after closing unsubmitted drafts", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));

    expect(container.querySelector(".parameters-bottom-actions")).not.toBeInTheDocument();
  });
});
