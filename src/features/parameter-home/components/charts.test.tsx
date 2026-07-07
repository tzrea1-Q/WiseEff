import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpdateTrendChart } from "./UpdateTrendChart";
import { ProjectRiskChart } from "./ProjectRiskChart";

describe("charts", () => {
  it("trend chart renders an accessible data table fallback", () => {
    render(
      <UpdateTrendChart
        points={[{ bucketStart: "2026-07-01T00:00:00Z", label: "7/1", changeCount: 3, workflowEventCount: 1 }]}
      />
    );
    expect(screen.getByRole("img", { name: /参数更新趋势/ })).toBeInTheDocument();
    expect(screen.getByText("7/1")).toBeInTheDocument();
  });

  it("risk chart labels risk levels", () => {
    render(
      <ProjectRiskChart
        buckets={[{ projectId: "aurora", projectCode: "AUR-Prod", projectName: "Aurora", high: 2, medium: 3, low: 1, total: 6 }]}
      />
    );
    expect(screen.getByRole("img", { name: /各项目参数风险分布/ })).toBeInTheDocument();
  });
});
