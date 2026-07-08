import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnalysisContextControls } from "./AnalysisContextControls";

describe("AnalysisContextControls", () => {
  it("emits window + dimension changes", () => {
    const onWindow = vi.fn();
    const onDimension = vi.fn();
    render(
      <AnalysisContextControls
        window="30d"
        dimension="project"
        projectScope={null}
        projectOptions={[{ value: "aurora", label: "Aurora" }]}
        onWindowChange={onWindow}
        onDimensionChange={onDimension}
        onProjectChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("radio", { name: "模块榜" }));
    expect(onDimension).toHaveBeenCalledWith("module");
  });

  it("defaults the project scope to all projects", () => {
    render(
      <AnalysisContextControls
        window="30d"
        dimension="project"
        projectScope={null}
        projectOptions={[{ value: "aurora", label: "Aurora" }]}
        onWindowChange={vi.fn()}
        onDimensionChange={vi.fn()}
        onProjectChange={vi.fn()}
      />
    );
    expect(screen.getByRole("combobox", { name: "项目范围" })).toHaveTextContent("全部项目");
  });

  it("renders hotspot dimensions in project-module-parameter order", () => {
    render(
      <AnalysisContextControls
        window="30d"
        dimension="project"
        projectScope={null}
        projectOptions={[]}
        onWindowChange={vi.fn()}
        onDimensionChange={vi.fn()}
        onProjectChange={vi.fn()}
      />
    );

    const labels = screen.getAllByRole("radio", { name: /榜$/ }).map((node) => node.textContent);
    expect(labels).toEqual(["项目榜", "模块榜", "参数榜"]);
  });

  it("hides hotspot dimension controls when disabled", () => {
    render(
      <AnalysisContextControls
        window="30d"
        dimension="project"
        projectScope={null}
        projectOptions={[]}
        showHotspotDimension={false}
        onWindowChange={vi.fn()}
        onDimensionChange={vi.fn()}
        onProjectChange={vi.fn()}
      />
    );
    expect(screen.queryByRole("group", { name: "热榜维度" })).not.toBeInTheDocument();
  });
});
