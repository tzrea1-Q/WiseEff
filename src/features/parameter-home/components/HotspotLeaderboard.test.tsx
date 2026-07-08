import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardHotspot } from "@/domain/parameters/dashboardTypes";
import { initialState } from "@/mockData";
import { HotspotLeaderboard } from "./HotspotLeaderboard";

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
    scoreBreakdown: { frequency: 40, scope: 36, workflow: 28, collaboration: 24 },
    evidence: [
      "累计修改 18 / 240 个参数（8%）",
      "窗口内 12 次参数变更",
      "待处理流程 3 项 · 窗口内 4 项请求"
    ],
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
    evidence: [
      "累计修改 10 / 180 个参数（6%）",
      "窗口内 6 次参数变更",
      "待处理流程 2 项 · 窗口内 3 项请求"
    ],
    trendDelta: -4,
    trendDirection: "down",
    suggestedPath: "/parameters?module=thermal"
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
  it("renders rows for provided hotspots", () => {
    renderLeaderboard();
    expect(screen.getByText("功率模块")).toBeInTheDocument();
    expect(screen.getByText("热管理")).toBeInTheDocument();
    expect(document.querySelectorAll(".parameter-home__hotspot-row")).toHaveLength(2);
  });

  it("moves focus with ArrowDown", () => {
    const { onSelectionChange } = renderLeaderboard();
    const rowButtons = screen.getAllByRole("button", { name: /热区 #/ });

    rowButtons[0].focus();
    fireEvent.keyDown(rowButtons[0], { key: "ArrowDown" });
    expect(rowButtons[1]).toHaveFocus();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("labels detail panels without a duplicate score heading", () => {
    renderLeaderboard();
    expect(screen.getByRole("region", { name: /功率模块 热榜详情/ })).toBeInTheDocument();
    expect(screen.queryByText(/热度评分构成/)).not.toBeInTheDocument();
  });

  it("exposes dimension bars as progressbar with aria-valuenow", () => {
    renderLeaderboard();
    const bars = screen.getAllByRole("progressbar");
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0]).toHaveAttribute("aria-valuenow");
  });

  it("toggles each row independently in accordion mode", () => {
    const { onToggleExpanded } = renderLeaderboard({ isAccordionMode: true, expandedIds: [] });

    fireEvent.click(screen.getByRole("button", { name: /展开热区 #1 功率模块/ }));
    expect(onToggleExpanded).toHaveBeenCalledWith("module:power");

    fireEvent.click(screen.getByRole("button", { name: /展开热区 #2 热管理/ }));
    expect(onToggleExpanded).toHaveBeenCalledWith("module:thermal");
  });

  it("renders detail panels for all expanded rows in accordion mode", () => {
    renderLeaderboard({ isAccordionMode: true, expandedIds: hotspots.map((hotspot) => hotspot.id) });

    expect(screen.getAllByRole("region", { name: /热榜详情/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /收起热区 #1 功率模块/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /收起热区 #2 热管理/ })).toHaveAttribute("aria-expanded", "true");
  });
});
