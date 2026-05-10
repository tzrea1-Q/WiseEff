import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParametersPage } from "./ParametersPage";
import { initialState } from "./mockData";

beforeEach(() => {
  cleanup();
});

function renderPage() {
  return render(
      <ParametersPage
        state={initialState}
        dispatch={vi.fn()}
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

describe("ParametersPage · 提交契约", () => {
  it("builds preview and submit items from selected draft entries only", () => {
    const source = readFileSync("src/ParametersPage.tsx", "utf8");
    const previewSource = source.match(/const pendingSubmissionItems[\s\S]*?\n  \);\n\n  useEffect/)?.[0] ?? "";
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
    const pageSource = readFileSync("src/ParametersPage.tsx", "utf8");
    const submitSource = pageSource.match(/const submitRound[\s\S]*?\n  };\n  const previewItems/)?.[0] ?? "";

    expect(roundReducerSource).toContain('case "ADD_PARAMETER_SUBMISSION_ROUND":');
    expect(roundReducerSource).not.toContain("action.reason");
    expect(submitSource).not.toContain("reason });");
  });

  it("未勾选任何行时，提交按钮禁用", () => {
    renderPage();
    const btn = screen.getByRole("button", { name: /提交本轮/ });
    expect(btn).toBeDisabled();
  });

  it("勾选 1 行后，按钮文案变为『提交本轮 (1 项)』并可点", () => {
    renderPage();
    const anyCheckbox = screen.getAllByRole("checkbox", {
      name: /勾选 /
    })[0];
    fireEvent.click(anyCheckbox);
    const btn = screen.getByRole("button", { name: "提交本轮 (1 项)" });
    expect(btn).toBeEnabled();
  });

  it("不存在『加入本轮』按钮", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /加入本轮/ })).not.toBeInTheDocument();
  });

  it("点击提交 → 弹出预览对话框，数量等于勾选数", () => {
    renderPage();
    const boxes = screen.getAllByRole("checkbox", { name: /勾选 / }).slice(0, 2);
    boxes.forEach((box) => fireEvent.click(box));
    fireEvent.click(screen.getByRole("button", { name: "提交本轮 (2 项)" }));
    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });
    expect(within(dialog).getAllByText(/→/).length).toBeGreaterThanOrEqual(2);
  });
});
