import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavigatorWorkbench } from "./NavigatorWorkbench";

const slots = {
  pageKey: "parameters",
  toolbar: <button>搜索</button>,
  primaryAction: <button>导出</button>,
  context: <button>项目上下文</button>,
  notice: <p role="status">待审阅</p>,
  navigator: <button aria-pressed="true">充电模块</button>,
  navigatorLabel: "模块导航",
  taskLabel: "参数列表",
  inspector: <button>参数详情</button>,
  inspectorLabel: "参数检查器",
  children: <button>编辑参数</button>
};

describe("NavigatorWorkbench", () => {
  beforeEach(() => localStorage.clear());

  it("names its regions and orders toolbar, context, notice, navigator, task and inspector", () => {
    const { container } = render(<NavigatorWorkbench {...slots} />);
    expect(screen.getByRole("region", { name: "模块导航" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "参数列表" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "参数检查器" })).toBeInTheDocument();
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "搜索", "导出", "项目上下文", "收起模块导航", "充电模块", "编辑参数", "参数详情"
    ]);
    const notice = screen.getByRole("status");
    expect(screen.getByText("项目上下文").compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(screen.getByRole("region", { name: "模块导航" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("persists collapse per page key without unmounting the selected module or changing the URL", () => {
    const view = render(<NavigatorWorkbench {...slots} />);
    const selection = screen.getByRole("button", { name: "充电模块" });
    const href = window.location.href;
    fireEvent.click(screen.getByRole("button", { name: "收起模块导航" }));
    expect(screen.getByRole("button", { name: "展开模块导航" })).toHaveAttribute("aria-expanded", "false");
    expect(selection).not.toBeVisible();
    expect(selection).toHaveAttribute("aria-pressed", "true");
    expect(window.location.href).toBe(href);
    view.rerender(<NavigatorWorkbench {...slots} pageKey="catalog" />);
    expect(screen.getByRole("button", { name: "收起模块导航" })).toHaveAttribute("aria-expanded", "true");
    view.rerender(<NavigatorWorkbench {...slots} />);
    expect(screen.getByRole("button", { name: "展开模块导航" })).toHaveAttribute("aria-expanded", "false");
    view.unmount();
    render(<NavigatorWorkbench {...slots} />);
    fireEvent.click(screen.getByRole("button", { name: "展开模块导航" }));
    expect(screen.getByRole("button", { name: "充电模块" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders shared loading, empty and retryable error states inside the task region", () => {
    const retry = vi.fn();
    const view = render(<NavigatorWorkbench {...slots} taskState={{ kind: "loading", message: "正在加载参数" }} />);
    expect(within(screen.getByRole("region", { name: "参数列表" })).getByRole("status")).toHaveTextContent("正在加载参数");
    expect(screen.queryByRole("button", { name: "编辑参数" })).not.toBeInTheDocument();
    view.rerender(<NavigatorWorkbench {...slots} taskState={{ kind: "empty", message: "暂无参数" }} />);
    expect(within(screen.getByRole("region", { name: "参数列表" })).getByText("暂无参数")).toBeInTheDocument();
    view.rerender(<NavigatorWorkbench {...slots} taskState={{ kind: "error", message: "无法加载参数", onRetry: retry }} />);
    const task = within(screen.getByRole("region", { name: "参数列表" }));
    expect(task.getByRole("alert")).toHaveTextContent("无法加载参数");
    fireEvent.click(task.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("keeps collapse usable when browser storage is unavailable", () => {
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      render(<NavigatorWorkbench {...slots} />);
      fireEvent.click(screen.getByRole("button", { name: "收起模块导航" }));
      expect(screen.getByRole("button", { name: "展开模块导航" })).toHaveAttribute("aria-expanded", "false");
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });
});
