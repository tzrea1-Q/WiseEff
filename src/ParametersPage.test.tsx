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

    expect(screen.getByText("Read-only access")).toBeVisible();
    expect(container.querySelector(".edit-row-button")).not.toBeInTheDocument();
    expect(container.querySelector<HTMLButtonElement>(".parameters-bottom-actions .button.primary")).toBeDisabled();
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

    expect(screen.getByText("Read-only access")).toBeVisible();
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
    expect(container.querySelector(".workbench-sheet")).toBeInTheDocument();

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

    expect(screen.getByText("Read-only access")).toBeVisible();
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
    ["导出 Excel", "历史提交", "跨项目对比"].forEach((label) => {
      const action = within(topbar as HTMLElement).getByRole("button", { name: label });
      expect(action).toHaveClass("button", "subtle");
    });

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

    expect(screen.getByRole("button", { name: "重要性 (1) ▾" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(table).queryByText("battery_temp_target_c")).not.toBeInTheDocument();
  });

  it("adds insight parameters to the draft sheet in one click", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "一键加入草稿" }));

    expect(screen.getByRole("dialog", { name: "修改草稿" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交本轮" })).toBeDisabled();
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
    const footer = container.querySelector<HTMLElement>(".draft-sheet-footer");
    const styles = readFileSync("src/styles.css", "utf8");
    expect(footer).not.toBeNull();
    expect(within(searchTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本轮已修改参数表" })).not.toBeInTheDocument();
    expect(within(footer!).queryByRole("button", { name: /暂存本轮/ })).not.toBeInTheDocument();
    expect(within(footer!).queryByRole("button", { name: /提交本轮/ })).not.toBeInTheDocument();
    expect(styles).toMatch(/\.draft-sheet-footer\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
    expect(styles).toMatch(/\.draft-sheet-footer-actions\s*\{[^}]*grid-row:\s*2;/s);
    expect(styles).toMatch(/\.draft-sheet-footer-actions\s*\{[^}]*justify-content:\s*flex-start;/s);

    const submitParameter = within(footer!).getByRole("button", { name: "提交参数" });
    expect(submitParameter).toBeEnabled();
    fireEvent.click(submitParameter);

    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /提交本轮参数/ })).not.toBeInTheDocument();
    const modifiedTable = screen.getByRole("region", { name: "本轮已修改参数表" });
    expect(within(modifiedTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(searchTable).queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();
    expect(container.querySelector<HTMLButtonElement>(".parameters-bottom-actions .button.primary")).toBeEnabled();
  });

  it("does not render an editable draft card for a focused unselected row", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getAllByText("charge_voltage_limit_mv")[0]);

    expect(container.querySelector(".workbench-sheet")).toBeInTheDocument();
    expect(container.querySelector(".focused-draft-editor")).not.toBeInTheDocument();
  });

  it("keeps preview closed when any selected draft has a blank target value", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));

    const targetInput = container.querySelector<HTMLTextAreaElement>(".draft-card textarea[aria-label*='目标值']");
    expect(targetInput).not.toBeNull();
    fireEvent.change(targetInput!, { target: { value: "   " } });

    const submitButton = container.querySelector<HTMLButtonElement>(".parameters-bottom-actions .button.primary");
    expect(submitButton).not.toBeNull();
    expect(submitButton).toBeDisabled();
    fireEvent.click(submitButton!);
    expect(container.querySelector(".submission-dialog")).not.toBeInTheDocument();
  });

  it("clears every draft from the sheet header", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));

    fireEvent.click(screen.getByRole("button", { name: "全部清空" }));

    expect(screen.queryByRole("dialog", { name: "修改草稿" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交本轮" })).toBeDisabled();
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

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_PARAMETER_SUBMISSION_ROUND",
      items: [
        expect.objectContaining({
          parameterId: initialState.parameters[0].id,
          reason: "submit cleanup reason"
        })
      ]
    });
    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(container.querySelector<HTMLButtonElement>(".parameters-bottom-actions .button.primary")).toBeDisabled();
  });
});

describe("ParametersPage · 提交契约", () => {
  it("builds preview and submit items from selected draft entries only", () => {
    const source = readFileSync("src/ParametersPage.tsx", "utf8");
    const previewSource = source.match(/const pendingSubmissionItems[\s\S]*?const allSelectedDraftsHaveTargets[\s\S]*?;/)?.[0] ?? "";
    const submitSource = source.match(/const submitRound[\s\S]*?\n  };\n  const previewItems/)?.[0] ?? "";

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
    const submitSource = pageSource.match(/const submitRound[\s\S]*?\n  };\n  const previewItems/)?.[0] ?? "";

    expect(roundReducerSource).toContain('case "ADD_PARAMETER_SUBMISSION_ROUND":');
    expect(roundReducerSource).toContain("submitParameterRound");
    expect(commandSource).not.toContain("input.reason");
    expect(submitSource).not.toContain("reason });");
  });

  it("未勾选任何行时，提交按钮禁用", () => {
    renderPage();
    const btn = screen.getByRole("button", { name: /提交本轮/ });
    expect(btn).toBeDisabled();
  });

  it("勾选 1 行后，按钮文案变为『提交本轮 (1 项)』并可点", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    const btns = screen.getAllByRole("button", { name: "提交本轮 (1 项)" });
    expect(btns[0]).toBeEnabled();
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

  it("removing the last draft item clears selection and closes the sheet", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "移除本项" }));

    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    const bottomSubmit = container.querySelector<HTMLButtonElement>(".parameters-bottom-actions .button.primary");
    expect(bottomSubmit).toBeDisabled();
  });

  it("bottom actions stay disabled after closing unsubmitted drafts", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));

    const bottomStash = container.querySelector<HTMLButtonElement>(".parameters-bottom-actions .button.subtle");
    expect(bottomStash).toBeDisabled();
    expect(bottomStash?.textContent).toContain("暂存本轮");
  });
});
