import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterAdminPage } from "./ParameterAdminPage";
import { initialState } from "./mockData";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/parameter-admin");
});

function renderPage(search = "") {
  return render(
    <ParameterAdminPage
      state={initialState}
      dispatch={vi.fn()}
      onNavigate={vi.fn()}
      search={search}
    />
  );
}

describe("ParameterAdminPage", () => {
  it("renders the page heading", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: /项目参数管理后台/ })).toBeInTheDocument();
  });

  it("renders at least one parameter list item", () => {
    renderPage();

    expect(screen.getAllByRole("button", { name: /fast_charge|charge_voltage|battery/ }).length).toBeGreaterThan(0);
  });

  it("renders a single page heading", () => {
    renderPage();

    expect(screen.getAllByRole("heading", { name: /项目参数管理后台/ })).toHaveLength(1);
  });

  it("renders the header action placeholders", () => {
    renderPage();
    const toolbar = screen.getByRole("toolbar", { name: "管理后台动作" });

    expect(within(toolbar).getByRole("button", { name: /批量导入/ })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /导出/ })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /权限/ })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /审计/ })).toBeInTheDocument();
  });

  it("renders five KPI strip items", () => {
    renderPage();
    const strip = screen.getByRole("region", { name: "参数管理后台指标" });

    expect(within(strip).getByText("共享参数")).toBeInTheDocument();
    expect(within(strip).getByText("高风险")).toBeInTheDocument();
    expect(within(strip).getByText("孤儿参数")).toBeInTheDocument();
    expect(within(strip).getByText("最近导入")).toBeInTheDocument();
  });
});
