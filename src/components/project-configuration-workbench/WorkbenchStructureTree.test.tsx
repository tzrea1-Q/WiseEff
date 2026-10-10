import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchStructureTree } from "./WorkbenchStructureTree";

describe("WorkbenchStructureTree", () => {
  it("exposes an empty structure as a disabled tree item with a live announcement", () => {
    render(
      <div role="tree" aria-label="成员文件">
        <WorkbenchStructureTree
          nodes={[]}
          fileId="file-empty"
          selectedNodePath={null}
          selectedPropertyName={null}
          sessionDrafts={{}}
          onSelectNode={vi.fn()}
          onSelectProperty={vi.fn()}
          ariaLabel="空文件节点树"
        />
      </div>
    );

    const empty = screen.getByRole("treeitem", { name: "没有可展示的结构节点。" });
    expect(screen.getByRole("group", { name: "空文件节点树" })).toContainElement(empty);
    expect(empty).toHaveAttribute("aria-disabled", "true");
    expect(empty).toHaveAttribute("aria-selected", "false");
    expect(empty).toHaveAttribute("aria-live", "polite");
    expect(empty).toHaveTextContent("没有可展示的结构节点。");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
