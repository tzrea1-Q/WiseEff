import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterAdminPage } from "./ParameterAdminPage";
import { initialState } from "./mockData";
import type { PowerManagementParameterTemplate } from "./powerManagementConfig";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/parameter-admin");
});

describe("ParameterAdminPage · a11y", () => {
  it("Tab 从搜索向风险 chip、模块下拉、覆盖下拉和排序控件顺序可达", () => {
    render(<ParameterAdminPage state={initialState} dispatch={() => {}} onNavigate={() => {}} search="" />);

    const search = screen.getByRole("searchbox", { name: "搜索参数" });
    const highRiskChip = screen.getByRole("button", { name: "高", pressed: false });
    const moduleDropdown = screen.getByRole("button", { name: "模块 ▾" });
    const coverageDropdown = screen.getByRole("button", { name: "覆盖 ▾" });
    const sortSelect = screen.getByRole("combobox", { name: "排序" });

    search.focus();
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "Tab" });
    highRiskChip.focus();
    expect(document.activeElement).toBe(highRiskChip);
    moduleDropdown.focus();
    expect(document.activeElement).toBe(moduleDropdown);
    coverageDropdown.focus();
    expect(document.activeElement).toBe(coverageDropdown);
    sortSelect.focus();
    expect(document.activeElement).toBe(sortSelect);
  });

  it("风险 chip 激活状态可通过 aria-pressed 读取", () => {
    render(<ParameterAdminPage state={initialState} dispatch={() => {}} onNavigate={() => {}} search="risk=high" />);

    expect(screen.getByRole("button", { name: "高", pressed: true })).toBeInTheDocument();
  });

  it("孤儿视角没有结果时展示庆祝空态", () => {
    const stateWithoutOrphans = {
      ...initialState,
      configDraft: {
        ...initialState.configDraft,
        parameterLibrary: initialState.configDraft.parameterLibrary.map((parameter) => ({
          ...parameter,
          values: fillAllProjectValues(parameter)
        }))
      }
    };

    render(<ParameterAdminPage state={stateWithoutOrphans} dispatch={() => {}} onNavigate={() => {}} search="coverage=orphan" />);

    expect(screen.getByText("所有参数都被项目使用中 · 没有孤儿")).toBeInTheDocument();
  });

  it("参数库为空时详情区提供新增和批量导入入口", () => {
    const dispatch = vi.fn();
    const emptyState = {
      ...initialState,
      configDraft: {
        ...initialState.configDraft,
        parameterLibrary: []
      }
    };

    render(<ParameterAdminPage state={emptyState} dispatch={dispatch} onNavigate={() => {}} search="" />);

    expect(screen.getByText("还没有任何参数。从下方开始")).toBeInTheDocument();
    const detailEmpty = document.querySelector(".detail-empty") as HTMLElement;
    fireEvent.click(within(detailEmpty).getByRole("button", { name: "新增参数" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "ADD_PROJECT_PARAMETER" });
    expect(within(detailEmpty).getByRole("button", { name: "批量导入" })).toBeInTheDocument();
  });
});

function fillAllProjectValues(parameter: PowerManagementParameterTemplate): PowerManagementParameterTemplate["values"] {
  return initialState.configDraft.projects.reduce<PowerManagementParameterTemplate["values"]>((values, project) => {
    values[project.id] =
      parameter.values[project.id] ?? {
        currentValue: "1",
        recommendedValue: "1",
        updatedAt: "2026-05-10T00:00:00.000Z"
      };
    return values;
  }, {} as PowerManagementParameterTemplate["values"]);
}
