import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DashboardHotspot } from "@/domain/parameters/dashboardTypes";
import { HotspotScorePanel } from "./HotspotScorePanel";

const projectHotspot: DashboardHotspot = {
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

const moduleHotspot: DashboardHotspot = {
  id: "module:charging",
  kind: "module",
  title: "Charging Policy",
  projectCode: "3 个项目",
  module: "Charging Policy",
  statusLabel: "需要关注",
  statusLevel: "watch",
  score: 160,
  scoreBreakdown: { frequency: 28, scope: 36, workflow: 22, collaboration: 14 },
  evidence: [
    "累计修改 20 / 300 个参数（7%）",
    "窗口内 10 次参数变更",
    "待处理流程 4 项 · 窗口内 5 项请求"
  ],
  trendDelta: 0,
  trendDirection: "flat",
  suggestedPath: "/parameters?module=Charging%20Policy"
};

const parameterHotspot: DashboardHotspot = {
  id: "parameter:max-charge-current",
  kind: "parameter",
  title: "Max Charge Current",
  projectCode: "4 个项目",
  module: "Charging Policy",
  statusLabel: "偏高",
  statusLevel: "elevated",
  score: 120,
  scoreBreakdown: { frequency: 24, scope: 32, workflow: 18, collaboration: 12 },
  evidence: [
    "已在 2 / 4 个项目中修改（50%）",
    "窗口内 6 次参数变更",
    "待处理流程 1 项 · 窗口内 2 项请求"
  ],
  trendDelta: 0,
  trendDirection: "flat",
  suggestedPath: "/parameters?parameter=max-charge-current"
};

describe("HotspotScorePanel", () => {
  it("renders module behavioral dimensions and evidence", () => {
    render(<HotspotScorePanel hotspot={moduleHotspot} dimensionCeiling={100} sectionId="hotspot-test" variant="accordion" />);

    expect(screen.getByText("累计修改范围")).toBeInTheDocument();
    expect(screen.getByText("协作广度")).toBeInTheDocument();
    expect(screen.queryByText("风险权重")).not.toBeInTheDocument();
    expect(screen.getByText("累计修改 20 / 300 个参数（7%）")).toBeInTheDocument();
  });

  it("renders project behavioral dimensions and evidence", () => {
    render(<HotspotScorePanel hotspot={projectHotspot} dimensionCeiling={100} sectionId="hotspot-test" variant="accordion" />);

    expect(screen.getByText("累计修改范围")).toBeInTheDocument();
    expect(screen.getByText("协作广度")).toBeInTheDocument();
    expect(screen.queryByText("风险权重")).not.toBeInTheDocument();
    expect(screen.getByText("累计修改 12 / 200 个参数（6%）")).toBeInTheDocument();
  });

  it("renders parameter behavioral dimensions with project scope label", () => {
    render(<HotspotScorePanel hotspot={parameterHotspot} dimensionCeiling={100} sectionId="hotspot-test" variant="accordion" />);

    expect(screen.getByText("项目修改范围")).toBeInTheDocument();
    expect(screen.queryByText("累计修改范围")).not.toBeInTheDocument();
    expect(screen.getByText("已在 2 / 4 个项目中修改（50%）")).toBeInTheDocument();
  });
});
