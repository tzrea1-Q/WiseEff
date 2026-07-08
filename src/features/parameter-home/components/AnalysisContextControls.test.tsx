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
        dimension="overall"
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
        dimension="overall"
        projectScope={null}
        projectOptions={[{ value: "aurora", label: "Aurora" }]}
        onWindowChange={vi.fn()}
        onDimensionChange={vi.fn()}
        onProjectChange={vi.fn()}
      />
    );
    expect(screen.getByRole("combobox", { name: "项目范围" })).toHaveTextContent("全部项目");
  });
});
