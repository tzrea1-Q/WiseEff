import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardState } from "@/application/parameters/dashboardState";
import type { DashboardSummary, DashboardHotspot } from "@/domain/parameters/dashboardTypes";
import { initialState } from "@/mockData";
import { ParameterHomePage } from "./ParameterHomePage";

const summary: DashboardSummary = {
  window: "30d",
  windowLabel: "近 30 天",
  projectId: null,
  kpis: {
    totalParameters: 51,
    managedProjects: 3,
    changeFrequency: 19,
    activeContributors: 5,
    highRiskParameters: 12
  },
  trend: [{ bucketStart: "2026-07-01T00:00:00Z", label: "7/1", changeCount: 3, workflowEventCount: 1 }],
  riskBuckets: [
    {
      projectId: "aurora",
      projectCode: "AUR-Prod",
      projectName: "Aurora",
      high: 2,
      medium: 3,
      low: 1,
      total: 6
    }
  ],
  workbenchSignals: {
    reviewQueue: 4,
    myDrafts: 2,
    returnedChanges: 1,
    waitingMerge: 3,
    unappliedImportBatches: 1,
    inactiveAccounts: 1
  }
};

const hotspot: DashboardHotspot = {
  id: "project:aurora",
  kind: "project",
  title: "AUR-Prod",
  projectCode: "AUR-Prod",
  module: "项目参数",
  statusLabel: "需要关注",
  statusLevel: "watch",
  score: 180,
  scoreBreakdown: { frequency: 30, risk: 30, impact: 30, workflow: 30, drift: 60 },
  evidence: ["高风险参数 2 项"],
  trendDelta: 0,
  trendDirection: "flat",
  suggestedPath: "/parameters?project=aurora"
};

function buildDashboardState(over: Partial<DashboardState> = {}): DashboardState {
  return {
    window: "30d",
    dimension: "overall",
    summary: { status: "ready", data: summary, error: null },
    hotspots: { status: "ready", data: [hotspot], error: null },
    ...over
  };
}

function renderPage(over: {
  roleId?: string;
  dashboardState?: DashboardState;
  runtime?: { loadSummary: ReturnType<typeof vi.fn>; loadHotspots: ReturnType<typeof vi.fn> };
} = {}) {
  const loadSummary = over.runtime?.loadSummary ?? vi.fn();
  const loadHotspots = over.runtime?.loadHotspots ?? vi.fn();

  render(
    <ParameterHomePage
      state={{ ...initialState, activeRoleId: over.roleId ?? "hardware-user" }}
      dashboardState={over.dashboardState ?? buildDashboardState()}
      dashboardRuntime={{ loadSummary, loadHotspots }}
      onDashboardWindowChange={vi.fn()}
      onDashboardDimensionChange={vi.fn()}
      onNavigate={vi.fn()}
      onNewProject={vi.fn()}
    />
  );

  return { loadSummary, loadHotspots };
}

describe("ParameterHomePage", () => {
  it("renders workbench first for user role with collapsed insight", () => {
    renderPage({ roleId: "hardware-user" });
    const sections = Array.from(document.querySelectorAll(".parameter-home > section, .parameter-home > div + section"));
    expect(screen.getByRole("region", { name: "个人工作台" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开洞察" })).toBeInTheDocument();
    expect(sections[0]).toHaveAttribute("aria-label", "个人工作台");
  });

  it("renders insight prominently for admin role", () => {
    renderPage({ roleId: "admin" });
    expect(screen.getByRole("img", { name: /参数更新趋势/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展开洞察" })).not.toBeInTheDocument();
  });

  it("shows situation skeleton while summary is loading", () => {
    renderPage({
      dashboardState: buildDashboardState({
        summary: { status: "loading", data: null, error: null }
      })
    });
    expect(screen.getByText("加载态势指标", { selector: ".sr-only" })).toBeInTheDocument();
  });

  it("retries summary load from situation error", () => {
    const { loadSummary } = renderPage({
      dashboardState: buildDashboardState({
        summary: { status: "error", data: null, error: "加载失败" }
      })
    });
    fireEvent.click(screen.getAllByRole("button", { name: "重试" })[0]);
    expect(loadSummary).toHaveBeenCalledWith({ projectId: initialState.activeProjectId, window: "30d" });
  });

  it("shows independent hotspot error", () => {
    renderPage({
      dashboardState: buildDashboardState({
        hotspots: { status: "error", data: [], error: "热榜失败" }
      }),
      roleId: "admin"
    });
    expect(screen.getByText("热榜失败")).toBeInTheDocument();
  });

  it("does not show review todos for guest", () => {
    renderPage({ roleId: "guest" });
    expect(screen.queryByText(/处理待审阅参数变更/)).not.toBeInTheDocument();
  });
});
