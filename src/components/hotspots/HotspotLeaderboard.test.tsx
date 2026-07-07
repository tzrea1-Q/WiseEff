import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HotspotLeaderboard } from "@/features/parameter-home/components/HotspotLeaderboard";
import type { DashboardHotspot } from "@/domain/parameters/dashboardTypes";
import { initialState } from "@/mockData";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const hotspots: DashboardHotspot[] = [
  {
    id: "module:power",
    kind: "module",
    title: "功率模块",
    projectCode: "AUR-Prod",
    module: "功率模块",
    statusLabel: "需要关注",
    statusLevel: "watch",
    score: 182.4,
    scoreBreakdown: { frequency: 40, risk: 36, impact: 30, workflow: 28, drift: 48.4 },
    evidence: ["近 30 天 12 次变更"],
    trendDelta: 8,
    trendDirection: "up",
    suggestedPath: "/parameters?module=power"
  },
  {
    id: "module:thermal",
    kind: "module",
    title: "热管理",
    projectCode: "AUR-Prod",
    module: "热管理",
    statusLabel: "偏高",
    statusLevel: "elevated",
    score: 146.2,
    scoreBreakdown: { frequency: 28, risk: 24, impact: 22, workflow: 26, drift: 46.2 },
    evidence: ["流程堆积 3 项"],
    trendDelta: -4,
    trendDirection: "down",
    suggestedPath: "/parameters?module=thermal"
  },
  {
    id: "module:comm",
    kind: "module",
    title: "通信模块",
    projectCode: "AUR-Prod",
    module: "通信模块",
    statusLabel: "正常",
    statusLevel: "normal",
    score: 96.5,
    scoreBreakdown: { frequency: 18, risk: 12, impact: 16, workflow: 14, drift: 36.5 },
    evidence: ["稳定运行"],
    trendDelta: 0,
    trendDirection: "flat",
    suggestedPath: "/parameters?module=comm"
  },
  {
    id: "module:safety",
    kind: "module",
    title: "安全策略",
    projectCode: "AUR-Prod",
    module: "安全策略",
    statusLabel: "偏高",
    statusLevel: "elevated",
    score: 132.1,
    scoreBreakdown: { frequency: 22, risk: 20, impact: 18, workflow: 20, drift: 52.1 },
    evidence: ["偏离推荐值"],
    trendDelta: 3,
    trendDirection: "up",
    suggestedPath: "/parameters?module=safety"
  },
  {
    id: "module:display",
    kind: "module",
    title: "显示配置",
    projectCode: "AUR-Prod",
    module: "显示配置",
    statusLabel: "正常",
    statusLevel: "normal",
    score: 88.3,
    scoreBreakdown: { frequency: 16, risk: 10, impact: 14, workflow: 12, drift: 36.3 },
    evidence: ["低风险"],
    trendDelta: -2,
    trendDirection: "down",
    suggestedPath: "/parameters?module=display"
  }
];

function renderLeaderboard(over: Partial<{ selectedId: string | null; isAccordionMode: boolean }> = {}) {
  const selectedId = over.selectedId ?? hotspots[0].id;
  const onNavigate = vi.fn();
  const onSelectionChange = vi.fn();

  render(
    <HotspotLeaderboard
      hotspots={hotspots}
      selectedId={selectedId}
      sectionId="test-hotspots"
      state={initialState}
      isAccordionMode={over.isAccordionMode ?? false}
      onNavigate={onNavigate}
      onSelectionChange={onSelectionChange}
    />
  );

  return { selectedId, onNavigate, onSelectionChange };
}

describe("HotspotLeaderboard", () => {
  it("renders five rows with a selected current row and one enter button per row", () => {
    renderLeaderboard();

    expect(document.querySelectorAll(".parameter-home__hotspot-row")).toHaveLength(hotspots.length);
    const rowButtons = screen.getAllByRole("button", { name: /选择热区/ });
    expect(rowButtons[0]).toHaveAttribute("aria-current", "true");
    expect(rowButtons.slice(1).every((button) => !button.hasAttribute("aria-current"))).toBe(true);
    expect(screen.getAllByRole("button", { name: /^进入 / })).toHaveLength(hotspots.length);
  });

  it("selects rows, preserves selection when entering, and triggers action navigation", () => {
    const { selectedId, onNavigate, onSelectionChange } = renderLeaderboard();
    const second = hotspots[1];

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`选择热区 #2 ${second.title}`) }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(second.id);

    const firstEnter = screen.getByRole("button", { name: `进入 ${hotspots[0].title}` });
    fireEvent.click(firstEnter);
    expect(onNavigate).toHaveBeenLastCalledWith(hotspots[0].suggestedPath);
    expect(onSelectionChange).not.toHaveBeenLastCalledWith(selectedId);

    fireEvent.click(screen.getByRole("button", { name: /查看 功率模块 漂移详情/ }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.stringContaining("/parameters?module="));
  });

  it("moves focus with arrow keys and selects with Enter", () => {
    const { onSelectionChange } = renderLeaderboard();
    const rowButtons = screen.getAllByRole("button", { name: /选择热区/ });

    rowButtons[0].focus();
    fireEvent.keyDown(rowButtons[0], { key: "ArrowDown" });
    expect(rowButtons[1]).toHaveFocus();
    expect(onSelectionChange).not.toHaveBeenCalled();

    fireEvent.keyDown(rowButtons[1], { key: "Enter" });
    expect(onSelectionChange).toHaveBeenLastCalledWith(hotspots[1].id);

    fireEvent.keyDown(rowButtons[1], { key: "End" });
    expect(rowButtons.at(-1)).toHaveFocus();
  });

  it("renders the detail panel inside the selected row in accordion mode", () => {
    renderLeaderboard({ isAccordionMode: true });
    const selectedRow = document.querySelector('.parameter-home__hotspot-row[data-selected="true"]') as HTMLElement;

    expect(within(selectedRow).getByRole("region", { name: /热度评分构成/ })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /热度评分构成/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: `选择热区 #1 ${hotspots[0].title}` })).toHaveAttribute("aria-expanded", "true");
  });
});
