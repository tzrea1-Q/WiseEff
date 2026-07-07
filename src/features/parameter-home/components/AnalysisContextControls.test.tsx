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
        onWindowChange={onWindow}
        onDimensionChange={onDimension}
      />
    );
    fireEvent.click(screen.getByRole("radio", { name: "模块榜" }));
    expect(onDimension).toHaveBeenCalledWith("module");
  });
});
