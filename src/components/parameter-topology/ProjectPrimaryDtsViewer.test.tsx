import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectPrimaryDtsViewer } from "./ProjectPrimaryDtsViewer";

describe("ProjectPrimaryDtsViewer", () => {
  it("renders meta, line numbers, and source text", () => {
    render(
      <ProjectPrimaryDtsViewer
        fileName="aurora-board.dts"
        versionNumber={3}
        text={"line-one\nline-two\nline-three"}
      />
    );
    expect(screen.getByText(/aurora-board\.dts · v3/)).toBeInTheDocument();
    expect(screen.getByText("line-two")).toBeInTheDocument();
    expect(screen.getByLabelText("DTS 源码")).toBeInTheDocument();
  });

  it("marks focusLine as highlighted", () => {
    const { container } = render(
      <ProjectPrimaryDtsViewer
        fileName="aurora-board.dts"
        versionNumber={1}
        text={"a\nb\nc"}
        focusLine={2}
      />
    );
    expect(container.querySelector('[data-line="2"]')).toHaveClass("is-focused");
  });
});
