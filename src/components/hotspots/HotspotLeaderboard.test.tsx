import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HotspotLeaderboard } from "../../ParameterManagementHomePage";
import { initialState } from "../../mockData";
import { deriveParameterHomepageAnalytics } from "../../parameterHomepageAnalytics";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderLeaderboard(over: Partial<{ selectedId: string | null; isAccordionMode: boolean }> = {}) {
  const analytics = deriveParameterHomepageAnalytics(initialState, "30d", "module");
  const selectedId = over.selectedId ?? analytics.hotspots[0].id;
  const onNavigate = vi.fn();
  const onSelectionChange = vi.fn();

  render(
    <HotspotLeaderboard
      hotspots={analytics.hotspots}
      selectedId={selectedId}
      sectionId="test-hotspots"
      state={initialState}
      isAccordionMode={over.isAccordionMode ?? false}
      onNavigate={onNavigate}
      onSelectionChange={onSelectionChange}
    />
  );

  return { analytics, selectedId, onNavigate, onSelectionChange };
}

describe("HotspotLeaderboard", () => {
  it("renders five rows with a selected current row and one enter button per row", () => {
    const { analytics } = renderLeaderboard();

    expect(document.querySelectorAll(".hotspot-row")).toHaveLength(analytics.hotspots.length);
    const rowButtons = screen.getAllByRole("button", { name: /选择热区/ });
    expect(rowButtons[0]).toHaveAttribute("aria-current", "true");
    expect(rowButtons.slice(1).every((button) => !button.hasAttribute("aria-current"))).toBe(true);
    expect(screen.getAllByRole("button", { name: /^进入 / })).toHaveLength(analytics.hotspots.length);
  });

  it("selects rows, preserves selection when entering, and triggers action navigation", () => {
    const { analytics, selectedId, onNavigate, onSelectionChange } = renderLeaderboard();
    const second = analytics.hotspots[1];

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`选择热区 #2 ${second.title}`) }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(second.id);

    const firstEnter = screen.getByRole("button", { name: `进入 ${analytics.hotspots[0].title}` });
    fireEvent.click(firstEnter);
    expect(onNavigate).toHaveBeenLastCalledWith(analytics.hotspots[0].suggestedPath);
    expect(onSelectionChange).not.toHaveBeenLastCalledWith(selectedId);

    fireEvent.click(screen.getByRole("button", { name: /创建高风险专项审阅/ }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.stringContaining("/parameter-review?filter=high-risk"));
  });

  it("moves focus with arrow keys and selects with Enter", () => {
    const { analytics, onSelectionChange } = renderLeaderboard();
    const rowButtons = screen.getAllByRole("button", { name: /选择热区/ });

    rowButtons[0].focus();
    fireEvent.keyDown(rowButtons[0], { key: "ArrowDown" });
    expect(rowButtons[1]).toHaveFocus();
    expect(onSelectionChange).not.toHaveBeenCalled();

    fireEvent.keyDown(rowButtons[1], { key: "Enter" });
    expect(onSelectionChange).toHaveBeenLastCalledWith(analytics.hotspots[1].id);

    fireEvent.keyDown(rowButtons[1], { key: "End" });
    expect(rowButtons.at(-1)).toHaveFocus();
  });

  it("renders the detail panel inside the selected row in accordion mode", () => {
    const { analytics } = renderLeaderboard({ isAccordionMode: true });
    const selectedRow = document.querySelector(".hotspot-row[data-selected=\"true\"]") as HTMLElement;

    expect(within(selectedRow).getByRole("region", { name: /AI 评分拆解/ })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /AI 评分拆解/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: `选择热区 #1 ${analytics.hotspots[0].title}` })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });
});
