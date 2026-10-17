import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";
import { WorkbenchStructureTree } from "./WorkbenchStructureTree";

const nodes: DtsStructuralNode[] = ["board", "board/core", "usb"].map((nodePath) => ({
  nodePath, name: nodePath, labels: [], phandleRefs: [],
  properties: [{ name: "status", valueType: "string-list", rawText: '"okay"', normalizedValue: "okay" }]
}));

describe("WorkbenchStructureTree", () => {
  it("selects only the property at the selected path and shows draft values when requested", () => {
    render(<WorkbenchStructureTree nodes={nodes} fileId="file" selectedNodePath="board/core"
      selectedPropertyName="status" sessionDrafts={{ "file::board/core::status": {
        rawText: '"disabled"', normalizedValue: "disabled"
      } }} onSelectNode={vi.fn()} onSelectProperty={vi.fn()} ariaLabel="结构" showValues />);
    expect(screen.getAllByRole("treeitem", { selected: true })).toEqual([
      screen.getByRole("treeitem", { name: "属性 board/core/status" })
    ]);
    expect(screen.getByRole("treeitem", { name: "属性 board/core/status" })).toHaveTextContent('"disabled"');
    expect(screen.getByRole("treeitem", { name: "属性 board/status" })).toHaveTextContent('"okay"');
  });

  it("provides one tab stop and navigates visible nodes and properties without bubbling selection", () => {
    const selectNode = vi.fn();
    const selectProperty = vi.fn();
    const outerKey = vi.fn();
    const { container } = render(<div role="tree" tabIndex={-1} onKeyDown={outerKey}><WorkbenchStructureTree nodes={nodes} fileId="file"
      selectedNodePath={null} selectedPropertyName={null} sessionDrafts={{}}
      onSelectNode={selectNode} onSelectProperty={selectProperty} ariaLabel="结构" /></div>);
    const board = screen.getByRole("treeitem", { name: "节点 board" });
    const core = screen.getByRole("treeitem", { name: "节点 board/core" });
    board.focus();
    fireEvent.keyDown(board, { key: "ArrowRight" });
    expect(core).toHaveFocus();
    fireEvent.keyDown(core, { key: "ArrowRight" });
    expect(core).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(core, { key: "ArrowRight" });
    const property = screen.getByRole("treeitem", { name: "属性 board/core/status" });
    expect(property).toHaveFocus();
    fireEvent.keyDown(property, { key: "Enter" });
    fireEvent.keyDown(property, { key: " " });
    expect(selectProperty).toHaveBeenNthCalledWith(1, "board/core", "status");
    expect(selectProperty).toHaveBeenCalledTimes(2);
    expect(selectNode).not.toHaveBeenCalled();
    expect(outerKey).not.toHaveBeenCalled();
    fireEvent.keyDown(property, { key: "ArrowLeft" });
    expect(core).toHaveFocus();
    fireEvent.keyDown(core, { key: "ArrowLeft" });
    expect(core).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(core, { key: "ArrowLeft" });
    expect(board).toHaveFocus();
    fireEvent.keyDown(board, { key: "End" });
    expect(screen.getByRole("treeitem", { name: "属性 usb/status" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(board).toHaveFocus();
    fireEvent.keyDown(board, { key: "ArrowDown" });
    expect(core).toHaveFocus();
    fireEvent.keyDown(core, { key: "ArrowUp" });
    expect(board).toHaveFocus();
    fireEvent.keyDown(board, { key: "Enter" });
    expect(selectNode).toHaveBeenCalledExactlyOnceWith("board");
    expect(container.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
  });

  it("exposes an empty structure as a disabled tree item with a live announcement", () => {
    render(
      <div role="tree" aria-label="配置文件">
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
