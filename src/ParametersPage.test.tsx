import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ParametersPage } from "./ParametersPage";
import { initialState } from "./mockData";

function renderPage() {
  return render(
    <ParametersPage
      state={initialState}
      dispatch={() => {}}
      onNavigate={() => {}}
      search=""
    />
  );
}

describe("ParametersPage (抽出后的模块)", () => {
  it("可以从独立模块引入并渲染工作台根节点", () => {
    renderPage();
    expect(screen.getByLabelText("参数筛选")).toBeInTheDocument();
  });
});
