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
  it("renders rows for provided hotspots", () => {
    renderLeaderboard();
    expect(screen.getByText("功率模块")).toBeInTheDocument();
    expect(screen.getByText("热管理")).toBeInTheDocument();
    expect(document.querySelectorAll(".parameter-home__hotspot-row")).toHaveLength(2);
  });

  it("moves focus with ArrowDown", () => {
    const { onSelectionChange } = renderLeaderboard();
    const rowButtons = screen.getAllByRole("button", { name: /选择热区/ });

    rowButtons[0].focus();
    fireEvent.keyDown(rowButtons[0], { key: "ArrowDown" });
    expect(rowButtons[1]).toHaveFocus();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('uses "热度评分构成" detail panel heading', () => {
    renderLeaderboard();
    expect(screen.getByRole("region", { name: /热度评分构成 · 功率模块/ })).toBeInTheDocument();
    expect(screen.queryByText(/AI 评分拆解/)).not.toBeInTheDocument();
  });

  it("exposes dimension bars as progressbar with aria-valuenow", () => {
    renderLeaderboard();
    const bars = screen.getAllByRole("progressbar");
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0]).toHaveAttribute("aria-valuenow");
  });
});
