import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { declarationsFor, readStylesheet } from "@/test/cssAssertions";
import { ProjectPrimaryDtsViewer } from "./ProjectPrimaryDtsViewer";

describe("ProjectPrimaryDtsViewer", () => {
  it("renders line numbers, source text and read-only source provenance", () => {
    render(
      <ProjectPrimaryDtsViewer
        fileName="aurora-board.dts"
        versionNumber={3}
        text={"line-one\nline-two\nline-three"}
      />
    );
    expect(screen.queryByText(/aurora-board\.dts · v3/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("aurora-board.dts · v3")).toBeInTheDocument();
    expect(screen.getByText("aurora-board.dts")).toBeVisible();
    expect(screen.getByText("版本 3")).toBeVisible();
    expect(screen.getByText("只读来源")).toBeVisible();
    expect(screen.getByText("line-two")).toBeInTheDocument();
    expect(screen.getByLabelText("DTS 源码")).toBeInTheDocument();
  });

  it("uses source-canvas theme tokens for provenance inside the dark configuration canvas", () => {
    const styles = readStylesheet("src/components/project-configuration-workbench/configuration-workbench.css");
    const meta = declarationsFor(styles, ".configuration-workbench__source .project-primary-dts-viewer__meta");
    expect(meta.color).toBe("var(--configuration-source-text-secondary)");
    expect(meta["border-bottom-color"]).toBe("var(--configuration-source-outline)");
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
    expect(container.querySelector('[data-line="2"]')).toHaveAttribute("data-focused", "true");
  });

  it("highlights a multi-line focusSpan and keeps find-next available", () => {
    const { container } = render(
      <ProjectPrimaryDtsViewer
        fileName="aurora-board.dts"
        versionNumber={1}
        text={"alpha\nbeta\ngamma\ndelta"}
        focusSpan={{ startLine: 2, endLine: 3 }}
        findQuery="a"
      />
    );
    expect(container.querySelector('[data-line="2"]')).toHaveAttribute("data-focused", "true");
    expect(container.querySelector('[data-line="3"]')).toHaveClass("is-focused");
    expect(container.querySelector('[data-line="1"]')).not.toHaveClass("is-focused");
    expect(container.querySelectorAll("mark.project-primary-dts-viewer__find-match").length).toBeGreaterThan(0);
  });
});
