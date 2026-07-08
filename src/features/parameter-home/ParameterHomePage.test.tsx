import { fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardState } from "@/application/parameters/dashboardState";
import type { DashboardSummary, DashboardHotspot } from "@/domain/parameters/dashboardTypes";
import { TopBarActionsContext } from "@/components/layout";
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
  personalKpis: {
    contributionCount: 0,
    workflowCount: 0,
    openItemCount: 0,
    pendingTodoCount: 0,
    highRiskTouchCount: 0
  },
  personalTrend: [],
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
  scoreBreakdown: { frequency: 30, scope: 40, workflow: 25, collaboration: 15 },
  evidence: [
    "累计修改 12 / 200 个参数（6%）",
    "窗口内 8 次参数变更",
    "待处理流程 2 项 · 窗口内 3 项请求"
  ],
  trendDelta: 0,
  trendDirection: "flat",
  suggestedPath: "/parameters?project=aurora"
};

function buildDashboardState(over: Partial<DashboardState> = {}): DashboardState {
  return {
    window: "30d",
    dimension: "project",
    overviewScope: "personal",
    projectScope: null,
    summary: { status: "ready", data: summary, error: null },
    hotspots: { status: "ready", data: [hotspot], error: null },
    ...over
  };
}

function TopBarActionsHarness({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null);
  const [leadingActions, setLeadingActions] = useState<ReactNode | null>(null);
  const value = useMemo(() => ({ setActions, setLeadingActions }), []);

  return (
    <TopBarActionsContext.Provider value={value}>
      <div data-testid="topbar-leading">{leadingActions}</div>
      {children}
    </TopBarActionsContext.Provider>
  );
}

function renderPage(over: {
  roleId?: string;
  dashboardState?: DashboardState;
  runtime?: { loadSummary: ReturnType<typeof vi.fn>; loadHotspots: ReturnType<typeof vi.fn> };
  onDashboardOverviewScopeChange?: ReturnType<typeof vi.fn>;
} = {}) {
  const loadSummary = over.runtime?.loadSummary ?? vi.fn();
  const loadHotspots = over.runtime?.loadHotspots ?? vi.fn();
  const onDashboardOverviewScopeChange = over.onDashboardOverviewScopeChange ?? vi.fn();

  render(
    <TopBarActionsHarness>
      <ParameterHomePage
        state={{ ...initialState, activeRoleId: over.roleId ?? "hardware-user" }}
        dashboardState={over.dashboardState ?? buildDashboardState()}
        dashboardRuntime={{ loadSummary, loadHotspots }}
        onDashboardWindowChange={vi.fn()}
        onDashboardDimensionChange={vi.fn()}
        onDashboardOverviewScopeChange={onDashboardOverviewScopeChange}
        onDashboardProjectChange={vi.fn()}
        onNavigate={vi.fn()}
        onNewProject={vi.fn()}
      />
    </TopBarActionsHarness>
  );

  return { loadSummary, loadHotspots, onDashboardOverviewScopeChange };
}

describe("ParameterHomePage", () => {
  it("defaults to the overview workbench page", () => {
    renderPage({ roleId: "hardware-user" });
    expect(screen.getByRole("region", { name: "个人工作台" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /参数更新趋势/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "热榜" })).not.toBeInTheDocument();
  });

  it("shows hotspot dimension controls only on the hotspot page", () => {
    renderPage({ roleId: "admin" });
    expect(screen.queryByRole("group", { name: "热榜维度" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /热榜/ }));
    expect(screen.getByRole("group", { name: "热榜维度" })).toBeInTheDocument();
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
    expect(loadSummary).toHaveBeenCalledWith({
      projectId: undefined,
      window: "30d",
      perspectiveRoleId: "hardware-user"
    });
  });

  it("shows independent hotspot error", () => {
    renderPage({
      dashboardState: buildDashboardState({
        hotspots: { status: "error", data: [], error: "热榜失败" }
      }),
      roleId: "admin"
    });
    fireEvent.click(screen.getByRole("radio", { name: /热榜/ }));
    expect(screen.getByText("热榜失败")).toBeInTheDocument();
  });

  it("does not show review todos for guest", () => {
    renderPage({ roleId: "guest" });
    expect(screen.queryByText(/处理待审阅参数变更/)).not.toBeInTheDocument();
  });

  it("renders a single in-page context control bar", () => {
    renderPage({ roleId: "admin" });
    expect(screen.getAllByRole("group", { name: "时间窗口" })).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "热榜维度" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /热榜/ }));
    expect(screen.getAllByRole("group", { name: "热榜维度" })).toHaveLength(1);
  });

  it("switches between workbench overview and hotspot pages", () => {
    renderPage({ roleId: "admin" });

    expect(screen.getByRole("group", { name: "工作台视图" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "待办事项" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "热榜" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /热榜/ }));
    expect(screen.getByRole("region", { name: "热榜" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "待办事项" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "热榜维度" })).toBeInTheDocument();
  });

  it("lays out situation overview beside update trend", () => {
    renderPage({ roleId: "admin" });
    expect(document.querySelector(".parameter-home__overview-row")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "概览", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "我的治理趋势" })).toBeInTheDocument();
  });

  it("defaults guest role to overall overview scope on mount", () => {
    const onDashboardOverviewScopeChange = vi.fn();
    renderPage({ roleId: "guest", onDashboardOverviewScopeChange });
    expect(onDashboardOverviewScopeChange).toHaveBeenCalledWith("overall");
  });

  it("defaults user role to personal overview scope on mount", () => {
    const onDashboardOverviewScopeChange = vi.fn();
    renderPage({ roleId: "hardware-user", onDashboardOverviewScopeChange });
    expect(onDashboardOverviewScopeChange).toHaveBeenCalledWith("personal");
  });

  it("shows overall KPI labels for guest role", () => {
    renderPage({
      roleId: "guest",
      dashboardState: buildDashboardState({ overviewScope: "overall" })
    });
    expect(screen.getByText("参数总量", { selector: ".parameter-home__situation-stat-label" })).toBeInTheDocument();
    expect(screen.queryByText("我的变更", { selector: ".parameter-home__situation-stat-label" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "参数更新趋势" })).toBeInTheDocument();
  });

  it("shows personal KPI labels for user role", () => {
    renderPage({
      roleId: "hardware-user",
      dashboardState: buildDashboardState({
        overviewScope: "personal",
        summary: {
          status: "ready",
          data: {
            ...summary,
            personalKpis: {
              ...summary.personalKpis,
              contributionCount: 4
            }
          },
          error: null
        }
      })
    });
    expect(screen.getByText("我的变更", { selector: ".parameter-home__situation-stat-label" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "我的变更趋势" })).toBeInTheDocument();
  });
});
