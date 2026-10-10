import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AnalysisContextControls } from "./AnalysisContextControls";

describe("AnalysisContextControls", () => {
  it("exposes the time window as a single selection and emits changes", () => {
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
    expect(screen.getByRole("radiogroup", { name: "时间窗口" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "近 30 天" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "近 7 天" }));
    expect(onWindow).toHaveBeenCalledWith("7d");
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
    expect(screen.getByRole("combobox", { name: "项目范围" })).toHaveAttribute("data-compact-control", "filter");
    expect(screen.queryByRole("radiogroup", { name: "项目范围" })).not.toBeInTheDocument();
  });

  it("preserves project selection and emits null when returning to all projects", async () => {
    const user = userEvent.setup();
    const onProjectChange = vi.fn();
    render(<AnalysisContextControls window="30d" dimension="project" projectScope="aurora"
      projectOptions={[{ value: "aurora", label: "Aurora" }, { value: "atlas", label: "Atlas" }]}
      onWindowChange={vi.fn()} onDimensionChange={vi.fn()} onProjectChange={onProjectChange} />);
    expect(screen.getByRole("combobox", { name: "项目范围" })).toHaveTextContent("Aurora");
    await user.click(screen.getByRole("combobox", { name: "项目范围" }));
    await user.click(screen.getByRole("option", { name: "Atlas" }));
    expect(onProjectChange).toHaveBeenCalledWith("atlas");
    await user.click(screen.getByRole("combobox", { name: "项目范围" }));
    await user.click(screen.getByRole("option", { name: "全部项目" }));
    expect(onProjectChange).toHaveBeenCalledWith(null);
  });

  it("renders hotspot dimensions in project-module-parameter order", () => {
    const onDimensionChange = vi.fn();
    render(
      <AnalysisContextControls
        window="30d"
        dimension="project"
        projectScope={null}
        projectOptions={[]}
        onWindowChange={vi.fn()}
        onDimensionChange={onDimensionChange}
        onProjectChange={vi.fn()}
      />
    );

    expect(screen.getByRole("radiogroup", { name: "热榜维度" })).toBeInTheDocument();
    const labels = screen.getAllByRole("radio", { name: /榜$/ }).map((node) => node.textContent);
    expect(labels).toEqual(["项目榜", "模块榜", "参数榜"]);
    fireEvent.click(screen.getByRole("radio", { name: "模块榜" }));
    expect(onDimensionChange).toHaveBeenCalledWith("module");
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
    expect(screen.queryByRole("radiogroup", { name: "热榜维度" })).not.toBeInTheDocument();
  });
});
