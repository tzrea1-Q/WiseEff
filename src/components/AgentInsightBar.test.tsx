import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentInsightBar } from "./AgentInsightBar";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("AgentInsightBar", () => {
  it("does not render for an empty item list", () => {
    const { container } = render(<AgentInsightBar items={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders headline, action, and dismiss controls", () => {
    const onAction = vi.fn();
    render(
      <AgentInsightBar
        items={[
          {
            id: "high-risk-orphans",
            tone: "warning",
            headline: "有 2 个高风险闲置参数",
            actions: [{ id: "view", label: "查看闲置参数", onClick: onAction }]
          }
        ]}
      />
    );

    expect(screen.getByText(/高风险闲置参数/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看闲置参数" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "今天先不看" })).toBeInTheDocument();
  });

  it("removes a dismissed insight and persists it in session storage", () => {
    render(
      <AgentInsightBar
        persistKey="param-admin-insights"
        items={[
          {
            id: "high-risk-orphans",
            tone: "warning",
            headline: "可关闭洞察",
            actions: []
          }
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "今天先不看" }));

    expect(screen.queryByText("可关闭洞察")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("param-admin-insights")).toContain("high-risk-orphans");
  });
});
