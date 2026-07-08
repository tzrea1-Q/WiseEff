import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HotspotLeaderboard } from "@/features/parameter-home/components/HotspotLeaderboard";
import type { DashboardHotspot } from "@/domain/parameters/dashboardTypes";
import { initialState } from "@/mockData";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const behavioralEvidence = [
  "累计修改 12 / 200 个参数（6%）",
  "窗口内 8 次参数变更",
  "待处理流程 2 项 · 窗口内 3 项请求"
];

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
    scoreBreakdown: { frequency: 40, scope: 36, workflow: 28, collaboration: 24 },
    evidence: behavioralEvidence,
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
    scoreBreakdown: { frequency: 28, scope: 24, workflow: 26, collaboration: 22 },
    evidence: behavioralEvidence,
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
    scoreBreakdown: { frequency: 18, scope: 16, workflow: 14, collaboration: 12 },
    evidence: behavioralEvidence,
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
    scoreBreakdown: { frequency: 22, scope: 20, workflow: 20, collaboration: 18 },
    evidence: behavioralEvidence,
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
    scoreBreakdown: { frequency: 16, scope: 14, workflow: 12, collaboration: 10 },
    evidence: behavioralEvidence,
    trendDelta: -2,
    trendDirection: "down",
    suggestedPath: "/parameters?module=display"
  }
];

function renderLeaderboard(
  over: Partial<{
    selectedId: string | null;
    expandedIds: string[];
    isAccordionMode: boolean;
  }> = {}
) {
  const selectedId = over.selectedId ?? hotspots[0].id;
  const expandedIds = over.expandedIds ?? (over.isAccordionMode ? [] : [selectedId].filter(Boolean) as string[]);
  const onSelectionChange = vi.fn();
  const onToggleExpanded = vi.fn();

  render(
    <HotspotLeaderboard
      hotspots={hotspots}
      selectedId={selectedId}
      expandedIds={expandedIds}
      sectionId="test-hotspots"
      state={initialState}
      isAccordionMode={over.isAccordionMode ?? false}
      onSelectionChange={onSelectionChange}
      onToggleExpanded={onToggleExpanded}
    />
  );

  return { selectedId, expandedIds, onSelectionChange, onToggleExpanded };
}

describe("HotspotLeaderboard", () => {
  it("renders five rows with a selected current row", () => {
    renderLeaderboard();

    expect(document.querySelectorAll(".parameter-home__hotspot-row")).toHaveLength(hotspots.length);
    const rowButtons = screen.getAllByRole("button", { name: /选择热区/ });
    expect(rowButtons[0]).toHaveAttribute("aria-current", "true");
    expect(rowButtons.slice(1).every((button) => !button.hasAttribute("aria-current"))).toBe(true);
    expect(document.querySelector(".parameter-home__hotspot-row-enter")).toBeNull();
  });

  it("selects rows in desktop mode", () => {
    const { onSelectionChange } = renderLeaderboard();
    const second = hotspots[1];

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`选择热区 #2 ${second.title}`) }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(second.id);
  });

  it("moves focus with arrow keys and selects with Enter", () => {
    const { onSelectionChange } = renderLeaderboard();
    const rowButtons = screen.getAllByRole("button", { name: /热区 #/ });

    rowButtons[0].focus();
    fireEvent.keyDown(rowButtons[0], { key: "ArrowDown" });
    expect(rowButtons[1]).toHaveFocus();
    expect(onSelectionChange).not.toHaveBeenCalled();

    fireEvent.keyDown(rowButtons[1], { key: "Enter" });
    expect(onSelectionChange).toHaveBeenLastCalledWith(hotspots[1].id);

    fireEvent.keyDown(rowButtons[1], { key: "End" });
    expect(rowButtons.at(-1)).toHaveFocus();
  });

  it("renders the detail panel inside each expanded row in accordion mode", () => {
    renderLeaderboard({ isAccordionMode: true, expandedIds: [hotspots[0].id, hotspots[1].id] });
    const selectedRows = document.querySelectorAll('.parameter-home__hotspot-row[data-selected="true"]');

    expect(selectedRows).toHaveLength(2);
    expect(within(selectedRows[0] as HTMLElement).getByRole("region", { name: /热榜详情/ })).toBeInTheDocument();
    expect(within(selectedRows[1] as HTMLElement).getByRole("region", { name: /热榜详情/ })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /热榜详情/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: `收起热区 #1 ${hotspots[0].title}` })).toHaveAttribute("aria-expanded", "true");
  });
});
