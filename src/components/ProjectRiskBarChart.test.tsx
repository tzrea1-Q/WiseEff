import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRiskBarChart } from "./ProjectRiskBarChart";
import type { ProjectRiskBucket } from "@/domain/parameters/dashboardTypes";

afterEach(() => {
  cleanup();
});

const buckets: ProjectRiskBucket[] = [
  {
    projectId: "aurora",
    projectCode: "AUR-Prod",
    projectName: "Aurora 量产平台",
    high: 10,
    medium: 8,
    low: 4,
    total: 22
  },
  {
    projectId: "nebula",
    projectCode: "NEB-RD",
    projectName: "Nebula 高频调试项目",
    high: 6,
    medium: 12,
    low: 3,
    total: 21
  },
  {
    projectId: "atlas",
    projectCode: "ATL-Intl",
    projectName: "Atlas 海外交付项目",
    high: 2,
    medium: 5,
    low: 6,
    total: 13
  }
];

const styles = readFileSync("src/styles.css", "utf8");

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"));
  return match?.[1] ?? "";
}

describe("ProjectRiskBarChart", () => {
  it("renders one vertical column per project bucket", () => {
    render(<ProjectRiskBarChart buckets={buckets} onNavigate={vi.fn()} />);
    expect(document.querySelectorAll('[data-testid="project-risk-row"]').length).toBe(
      buckets.length
    );
  });

  it("uses height-based stacked segments for vertical bars", () => {
    render(<ProjectRiskBarChart buckets={buckets} onNavigate={vi.fn()} />);
    const firstHighSegment = document.querySelector(
      ".project-risk-segment.risk-high"
    ) as HTMLElement;

    expect(firstHighSegment).toBeTruthy();
    expect(firstHighSegment.style.height).toBe("45.45%");
    expect(firstHighSegment.style.width).toBe("");
  });

  it("shows project codes as axis labels", () => {
    render(<ProjectRiskBarChart buckets={buckets} onNavigate={vi.fn()} />);
    expect(screen.getByText("AUR-Prod")).toBeInTheDocument();
    expect(screen.getByText("NEB-RD")).toBeInTheDocument();
    expect(screen.getByText("ATL-Intl")).toBeInTheDocument();
  });

  it("invokes onNavigate with a /parameters?project= path when a row is clicked", () => {
    const onNavigate = vi.fn();
    render(<ProjectRiskBarChart buckets={buckets} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /AUR-Prod/ }));
    expect(onNavigate).toHaveBeenCalledWith("/parameters?project=aurora");
  });

  it("renders a tooltip area with totals on hover", () => {
    render(<ProjectRiskBarChart buckets={buckets} onNavigate={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /AUR-Prod/ }));
    const tooltip = screen.getByTestId("project-risk-tooltip");
    expect(tooltip).toHaveTextContent("AUR-Prod");
    expect(tooltip).toHaveTextContent("高 10");
    expect(tooltip).toHaveTextContent("中 8");
    expect(tooltip).toHaveTextContent("低 4");
    expect(tooltip).toHaveTextContent("总 22");
  });

  it("renders an empty-state message when buckets is empty", () => {
    render(<ProjectRiskBarChart buckets={[]} onNavigate={vi.fn()} />);
    expect(screen.getByText(/暂无项目/)).toBeInTheDocument();
  });

  it("uses the updated chart label", () => {
    render(<ProjectRiskBarChart buckets={buckets} onNavigate={vi.fn()} />);
    expect(document.querySelector(".project-risk-bar-chart")).toHaveAttribute(
      "aria-label",
      "各项目参数更新情况"
    );
  });

  it("keeps the hover tooltip out of normal layout flow", () => {
    const tooltipRule = cssRule(".project-risk-tooltip");

    expect(tooltipRule).toContain("position: absolute;");
    expect(tooltipRule).not.toContain("margin-top:");
  });
});
