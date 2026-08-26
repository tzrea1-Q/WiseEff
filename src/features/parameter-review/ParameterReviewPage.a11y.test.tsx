import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterReviewPage } from "./ParameterReviewPage";
import { TopBarActionsContext } from "@/components/layout";
import { initialState } from "@/mockData";
import type { PrototypeState } from "@/mockData";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function hardwareCommitterState(): PrototypeState {
  return { ...initialState, activeRoleId: "hardware-committer" };
}

function renderReview(state: PrototypeState = hardwareCommitterState()) {
  render(
    <TopBarActionsContext.Provider value={{ setActions: () => {} }}>
      <ParameterReviewPage state={state} dispatch={vi.fn()} onNavigate={() => {}} search="" />
    </TopBarActionsContext.Provider>
  );
}

describe("ParameterReviewPage landmarks and keyboard", () => {
  it("exposes queue/detail headings and Chinese status labels without Committer/User leaks", () => {
    renderReview();

    expect(screen.getByRole("heading", { level: 2, name: "审阅队列" })).toBeInTheDocument();
    const detail = screen.getByRole("complementary", { name: "审阅详情" });
    expect(within(detail).getByRole("heading", { level: 2, name: "审阅详情" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "审阅队列" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/快捷键/);
    expect(screen.queryByText(/Committer/)).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "审阅队列" })).not.toHaveTextContent("User");
  });

  it("lets keyboard users move the selected queue row without ⌘/Ctrl", () => {
    renderReview();

    const table = screen.getByRole("table", { name: "审阅队列" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(window, { key: "j" });
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(rows[0]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(window, { key: "k" });
    expect(rows[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(window, { key: "j", metaKey: true });
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
  });

  it("opens submission detail with Enter from the selected change row", () => {
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: /查看 快充输入电流调整 提交详情/ }).closest("tr")!);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "提交详情" })).toBeInTheDocument();
  });

  it("exposes the module filter as a collapsed hierarchy with ancestor selection", () => {
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: "筛选模块" }));
    const menu = screen.getByRole("group", { name: "模块筛选" });
    const tree = within(menu).getByRole("tree");
    expect(within(tree).getByRole("treeitem", { name: "Power" })).toBeInTheDocument();
    expect(within(tree).queryByRole("treeitem", { name: "Charging" })).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("checkbox", { name: "Power" }));
    const selectedPower = within(menu).getByRole("treeitem", { name: "Power" });
    expect(selectedPower).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(selectedPower).getByRole("button", { name: "展开" }));
    expect(within(menu).getByRole("treeitem", { name: "Charging" })).toHaveAttribute("aria-checked", "true");
  });
});
