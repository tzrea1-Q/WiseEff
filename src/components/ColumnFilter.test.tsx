import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ColumnFilter } from "./ColumnFilter";

describe("ColumnFilter", () => {
  it("opens a compact header menu and toggles checkbox values", async () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();

    render(
      <ColumnFilter
        label="模块"
        groupLabel="模块筛选"
        values={["Charging Policy", "Battery Safety"]}
        selectedValues={["Battery Safety"]}
        onToggle={onToggle}
        onClear={onClear}
      />
    );

    const trigger = screen.getByRole("button", { name: "筛选模块" });
    expect(trigger).toHaveClass("active");

    await userEvent.click(trigger);
    const menu = screen.getByRole("group", { name: "模块筛选" });

    await userEvent.click(within(menu).getByRole("checkbox", { name: "Charging Policy" }));
    await userEvent.click(within(menu).getByRole("button", { name: "清除" }));

    expect(onToggle).toHaveBeenCalledWith("Charging Policy");
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders hierarchical options and returns canonical selected roots", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn();

    render(
      <ColumnFilter
        label="所属模块"
        groupLabel="所属模块筛选"
        mode="tree"
        treeNodes={[
          { id: "power", label: "电源", parentId: null, path: "电源" },
          { id: "charging", label: "充电", parentId: "power", path: "电源 / 充电" }
        ]}
        selectedTreeIds={[]}
        onTreeChange={onTreeChange}
        onClear={vi.fn()}
        treeHideSingleRoot={false}
      />
    );

    await user.click(screen.getByRole("button", { name: "筛选所属模块" }));
    const menu = screen.getByRole("group", { name: "所属模块筛选" });
    await user.click(within(menu).getByRole("checkbox", { name: "电源" }));

    expect(onTreeChange).toHaveBeenCalledWith(["power"]);
    expect(within(menu).getByRole("tree")).toBeInTheDocument();
  });

  it("hides a sole root, keeps branches collapsed, and omits module paths", async () => {
    const user = userEvent.setup();

    render(
      <ColumnFilter
        label="所属模块"
        groupLabel="所属模块筛选"
        mode="tree"
        treeNodes={[
          { id: "power", label: "电源", parentId: null, path: "电源" },
          { id: "battery", label: "电池", parentId: "power", path: "电源 / 电池" },
          { id: "health", label: "健康", parentId: "battery", path: "电源 / 电池 / 健康" }
        ]}
        selectedTreeIds={[]}
        onTreeChange={() => undefined}
        onClear={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "筛选所属模块" }));
    const menu = screen.getByRole("group", { name: "所属模块筛选" });
    const tree = within(menu).getByRole("tree");
    expect(within(tree).queryByRole("treeitem", { name: "电源" })).not.toBeInTheDocument();
    expect(within(tree).getByRole("treeitem", { name: "电池" })).toHaveAttribute("aria-level", "1");
    expect(within(tree).queryByRole("treeitem", { name: "健康" })).not.toBeInTheDocument();
    expect(within(menu).queryByText("电源 / 电池")).not.toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the funnel trigger", async () => {
    const user = userEvent.setup();
    render(
      <ColumnFilter
        label="模块"
        groupLabel="模块筛选"
        mode="tree"
        treeNodes={[{ id: "power", label: "电源", parentId: null }]}
        selectedTreeIds={[]}
        onTreeChange={() => undefined}
        onClear={() => undefined}
      />
    );

    const trigger = screen.getByRole("button", { name: "筛选模块" });
    await user.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("group", { name: "模块筛选" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
