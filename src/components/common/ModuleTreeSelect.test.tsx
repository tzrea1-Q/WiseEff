import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModuleTreeSelect } from "./ModuleTreeSelect";

const nodes = [
  { id: "pm-a", name: "电源", parentId: null, path: "pm-a", depth: 1 },
  { id: "pm-b", name: "电池", parentId: "pm-a", path: "pm-a/pm-b", depth: 2 },
  { id: "pm-c", name: "充电", parentId: null, path: "pm-c", depth: 1 }
] as const;

describe("ModuleTreeSelect", () => {
  it("expands and collapses tree nodes", () => {
    render(<ModuleTreeSelect mode="multi-filter" label="模块" nodes={[...nodes]} value={[]} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    expect(screen.getByText("电池")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "折叠" }));
    expect(screen.queryByText("电池")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.getByText("电池")).toBeInTheDocument();
  });

  it("selecting a parent in multi-filter mode includes subtree ids", () => {
    const onChange = vi.fn();
    render(<ModuleTreeSelect mode="multi-filter" label="模块" nodes={[...nodes]} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "电源" }));
    expect(onChange).toHaveBeenCalledWith(["pm-a", "pm-b"]);
  });

  it("single-select mode chooses one module and closes", () => {
    const onChange = vi.fn();
    render(<ModuleTreeSelect mode="single" label="模块" nodes={[...nodes]} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(within(screen.getByRole("tree")).getByRole("button", { name: "充电" }));
    expect(onChange).toHaveBeenCalledWith("pm-c");
  });

  it("highlights the selected module in single-select mode", () => {
    render(<ModuleTreeSelect mode="single" label="模块" nodes={[...nodes]} value="pm-c" onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /充电/ }));

    const selectedOption = within(screen.getByRole("tree")).getByRole("button", { name: "充电" });
    expect(selectedOption).toHaveClass("is-selected");
    expect(selectedOption).toHaveAttribute("aria-current", "true");
    expect(selectedOption.closest(".module-tree-option-row")).toHaveClass("is-selected");
  });

  it("shows the selected module path in single-select mode", () => {
    const hierarchy = [
      { id: "pm-a", name: "电源", parentId: null, path: "pm-a", depth: 1 },
      { id: "pm-b", name: "电池", parentId: "pm-a", path: "pm-a/pm-b", depth: 2 },
      { id: "pm-d", name: "电池健康", parentId: "pm-b", path: "pm-a/pm-b/pm-d", depth: 3 },
      { id: "pm-c", name: "充电", parentId: null, path: "pm-c", depth: 1 }
    ];

    render(<ModuleTreeSelect mode="single" label="模块" nodes={hierarchy} value="pm-d" onChange={() => undefined} />);

    expect(screen.getByRole("button", { name: /电源 \/ 电池 \/ 电池健康/ })).toBeInTheDocument();
    expect(screen.queryByText("电池健康", { selector: ".module-tree-trigger-label" })).not.toBeInTheDocument();
  });

  it("expands ancestor branches when opening a nested selection", () => {
    const hierarchy = [
      { id: "pm-a", name: "电源", parentId: null, path: "pm-a", depth: 1 },
      { id: "pm-b", name: "电池", parentId: "pm-a", path: "pm-a/pm-b", depth: 2 },
      { id: "pm-d", name: "电池健康", parentId: "pm-b", path: "pm-a/pm-b/pm-d", depth: 3 },
      { id: "pm-c", name: "充电", parentId: null, path: "pm-c", depth: 1 }
    ];

    render(<ModuleTreeSelect mode="single" label="模块" nodes={hierarchy} value="pm-d" onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /电源 \/ 电池 \/ 电池健康/ }));

    expect(within(screen.getByRole("tree")).getByRole("button", { name: /电池健康/ })).toBeInTheDocument();
    expect(screen.getByText("电源 / 电池 / 电池健康")).toBeInTheDocument();
    expect(within(screen.getByRole("tree")).queryByText("电源 / 电池 / 电池健康")).not.toBeInTheDocument();
  });
});
