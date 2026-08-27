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
    expect(screen.queryByText("电源 / 电池")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "折叠" }));
    expect(screen.queryByText("电池")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.getByText("电池")).toBeInTheDocument();
  });

  it("selecting a parent in multi-filter mode stores one canonical root id", () => {
    const onChange = vi.fn();
    render(<ModuleTreeSelect mode="multi-filter" label="模块" nodes={[...nodes]} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "电源" }));
    expect(onChange).toHaveBeenCalledWith(["pm-a"]);
  });

  it("single-select mode chooses one module and closes", () => {
    const onChange = vi.fn();
    render(<ModuleTreeSelect mode="single" label="模块" nodes={[...nodes]} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(within(screen.getByRole("tree")).getByRole("button", { name: "充电" }));
    expect(onChange).toHaveBeenCalledWith("pm-c");
  });

  it("offers an explicit root option for single-select moves", () => {
    const onChange = vi.fn();
    render(
      <ModuleTreeSelect
        mode="single"
        label="目标父模块"
        nodes={[...nodes]}
        value="pm-b"
        onChange={onChange}
        includeRootOption
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /电源 \/ 电池/ }));
    const tree = screen.getByRole("tree");
    const rootOption = within(tree).getByRole("button", { name: "根级（无父模块）" });

    expect(rootOption).toBeInTheDocument();
    fireEvent.click(rootOption);

    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
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

  it("only allows selecting ids listed in selectableIds", () => {
    const onChange = vi.fn();
    render(
      <ModuleTreeSelect
        mode="single"
        label="模块"
        nodes={[...nodes]}
        value=""
        selectableIds={new Set(["pm-b"])}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    const tree = screen.getByRole("tree");
    expect(within(tree).queryByRole("button", { name: "电源" })).not.toBeInTheDocument();
    expect(within(tree).getByText("电源")).toBeInTheDocument();
    fireEvent.click(within(tree).getByRole("button", { name: "电池" }));
    expect(onChange).toHaveBeenCalledWith("pm-b");
  });

  it("can portal its menu outside an overflow container", () => {
    render(
      <div style={{ overflow: "hidden" }}>
        <ModuleTreeSelect
          mode="multi-filter"
          label="模块"
          nodes={[...nodes]}
          value={[]}
          onChange={() => undefined}
          portalMenu
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "模块" }));

    expect(screen.getByRole("tree").parentElement).toBe(document.body);
  });
});
