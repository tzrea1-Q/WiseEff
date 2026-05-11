import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterInsightBar } from "./ParameterInsightBar";
import type { ParameterWorkbenchInsightSnapshot } from "../parameterWorkbenchInsights";

const snapshot: ParameterWorkbenchInsightSnapshot = {
  driftedCount: 3,
  highRiskCount: 1,
  mediumRiskCount: 2,
  topParameters: [
    {
      id: "p1",
      projectId: "aurora",
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      currentValue: "3850",
      recommendedValue: "3200",
      unit: "mA",
      risk: "High",
      driftLabel: "-16.9%",
      driftMagnitude: 16.9
    }
  ]
};

afterEach(() => {
  cleanup();
});

describe("ParameterInsightBar", () => {
  it("renders an expanded insight with counts and the strongest parameter", () => {
    render(
      <ParameterInsightBar
        snapshot={snapshot}
        collapsed={false}
        onExpand={vi.fn()}
        onViewHighRisk={vi.fn()}
        onAddToDraft={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Agent 发现 3 个参数偏离推荐值");
    expect(screen.getByText(/高风险 1/)).toBeInTheDocument();
    expect(screen.getByText(/中风险 2/)).toBeInTheDocument();
    expect(screen.getByText(/fast_charge_current_limit_ma/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看高风险" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "一键加入草稿" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "今天先不看" })).toBeInTheDocument();
  });

  it("renders a compact recall affordance when collapsed", () => {
    const onExpand = vi.fn();
    render(
      <ParameterInsightBar
        snapshot={snapshot}
        collapsed
        onExpand={onExpand}
        onViewHighRisk={vi.fn()}
        onAddToDraft={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "展开 3 项 Agent 洞察" }));

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("fires insight actions", () => {
    const onViewHighRisk = vi.fn();
    const onAddToDraft = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ParameterInsightBar
        snapshot={snapshot}
        collapsed={false}
        onExpand={vi.fn()}
        onViewHighRisk={onViewHighRisk}
        onAddToDraft={onAddToDraft}
        onDismiss={onDismiss}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看高风险" }));
    fireEvent.click(screen.getByRole("button", { name: "一键加入草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭洞察" }));

    expect(onViewHighRisk).toHaveBeenCalledTimes(1);
    expect(onAddToDraft).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when there are no drifted parameters", () => {
    const { container } = render(
      <ParameterInsightBar
        snapshot={{ driftedCount: 0, highRiskCount: 0, mediumRiskCount: 0, topParameters: [] }}
        collapsed={false}
        onExpand={vi.fn()}
        onViewHighRisk={vi.fn()}
        onAddToDraft={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
