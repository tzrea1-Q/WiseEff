import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TreeFilterOptions } from "./TreeFilterOptions";

const nodes = [
  { id: "power", label: "电源", parentId: null, path: "电源", sortOrder: 1, count: 4 },
  { id: "battery", label: "电池", parentId: "power", path: "电源 / 电池", sortOrder: 1, count: 2 },
  { id: "battery-health", label: "电池健康", parentId: "battery", path: "电源 / 电池 / 电池健康", sortOrder: 1, count: 1 },
  { id: "charging", label: "充电", parentId: "power", path: "电源 / 充电", sortOrder: 2, count: 2 },
  { id: "thermal", label: "热管理", parentId: null, path: "热管理", sortOrder: 2, count: 1 }
] as const;

describe("TreeFilterOptions", () => {
  it("derives a mixed parent state from canonical selected roots", () => {
    render(
      <TreeFilterOptions
        mode="multi"
        nodes={nodes}
        selectedIds={["battery"]}
        onChange={() => undefined}
      />
    );

    const tree = screen.getByRole("tree");
    const power = within(tree).getByRole("treeitem", { name: "电源" });
    const checkbox = within(power).getByRole("checkbox", { name: "电源" }) as HTMLInputElement;

    expect(power).toHaveAttribute("aria-checked", "mixed");
    expect(checkbox).toHaveAttribute("aria-checked", "mixed");
    expect(checkbox.indeterminate).toBe(true);
  });

  it("searches labels and paths while retaining matching ancestors", async () => {
    const user = userEvent.setup();
    render(
      <TreeFilterOptions
        mode="multi"
        nodes={nodes}
        selectedIds={["charging"]}
        searchable
        onChange={() => undefined}
      />
    );

    await user.type(screen.getByRole("searchbox", { name: "搜索模块" }), "健康");

    const tree = screen.getByRole("tree");
    expect(within(tree).getByRole("treeitem", { name: "电源" })).toBeInTheDocument();
    expect(within(tree).getByRole("treeitem", { name: "电池" })).toBeInTheDocument();
    expect(within(tree).getByRole("treeitem", { name: "电池健康" })).toBeInTheDocument();
    expect(within(tree).queryByRole("treeitem", { name: "充电" })).not.toBeInTheDocument();
  });

  it("supports roving tree keyboard navigation and selection", () => {
    const onChange = vi.fn();
    render(<TreeFilterOptions mode="multi" nodes={nodes} selectedIds={[]} onChange={onChange} />);

    const tree = screen.getByRole("tree");
    const power = within(tree).getByRole("treeitem", { name: "电源" });
    const battery = within(tree).getByRole("treeitem", { name: "电池" });

    power.focus();
    fireEvent.keyDown(power, { key: "ArrowDown" });
    expect(battery).toHaveFocus();

    fireEvent.keyDown(battery, { key: " " });
    expect(onChange).toHaveBeenCalledWith(["battery"]);

    fireEvent.keyDown(battery, { key: "ArrowLeft" });
    expect(battery).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(battery, { key: "ArrowLeft" });
    expect(power).toHaveFocus();
  });

  it("keeps disabled nodes structural and renders an empty state", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TreeFilterOptions
        mode="multi"
        nodes={[{ id: "root", label: "根模块", parentId: null, disabled: true }]}
        selectedIds={[]}
        onChange={onChange}
      />
    );

    const root = screen.getByRole("treeitem", { name: "根模块" });
    expect(within(root).getByRole("checkbox", { name: "根模块" })).toBeDisabled();
    fireEvent.keyDown(root, { key: " " });
    expect(onChange).not.toHaveBeenCalled();

    rerender(<TreeFilterOptions mode="multi" nodes={[]} selectedIds={[]} onChange={onChange} />);
    expect(screen.getByText("暂无选项")).toBeInTheDocument();
  });
});
