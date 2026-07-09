import { fireEvent, render, screen } from "@testing-library/react";
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
    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.getByText("电池")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "折叠" }));
    expect(screen.queryByText("电池")).not.toBeInTheDocument();
  });

  it("selecting a parent in multi-filter mode includes subtree ids", () => {
    const onChange = vi.fn();
    render(<ModuleTreeSelect mode="multi-filter" label="模块" nodes={[...nodes]} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "电源" }));
    expect(onChange).toHaveBeenCalledWith(["pm-a", "pm-b"]);
  });

  it("single-select mode chooses one module and closes", () => {
    const onChange = vi.fn();
    render(<ModuleTreeSelect mode="single" label="模块" nodes={[...nodes]} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(screen.getByRole("button", { name: "充电" }));
    expect(onChange).toHaveBeenCalledWith("pm-c");
  });
});
