import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { ModuleMoveDialog } from "./ModuleMoveDialog";

const root: ParameterModule = { id: "power", name: "电源", parentId: null, sortOrder: 0,
  description: "", scope: "", importance: "medium", effectiveImportance: "medium", kind: "business",
  origin: "curated", sourceKey: null, parameterCount: 0, definitionCount: 0 };
const child = { ...root, id: "battery", name: "电池", parentId: root.id };
const leaf = { ...root, id: "health", name: "健康", parentId: child.id };
const modules = [root, child, leaf];

describe("ModuleMoveDialog", () => {
  it("lets node types move under driver groups while excluding their own subtree", () => {
    const driver = { ...root, id: "driver", name: "驱动", kind: "driver-group" as const };
    const node = { ...child, kind: "node-type" as const };
    const descendant = { ...leaf, kind: "node-type" as const };
    const onConfirm = vi.fn();
    render(<ModuleMoveDialog module={node} modules={[root, node, descendant, driver]} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "目标上级模块" }));
    const tree = screen.getByRole("tree");
    expect(within(tree).queryByRole("button", { name: "健康" })).not.toBeInTheDocument();
    fireEvent.click(within(tree).getByRole("button", { name: "驱动" }));
    fireEvent.click(screen.getByRole("button", { name: "确认移动" }));
    expect(onConfirm).toHaveBeenCalledWith("driver");
  });
  it("starts from the current parent, prevents no-op writes, excludes descendants and explicitly supports root", () => {
    const onConfirm = vi.fn();
    render(<ModuleMoveDialog module={child} modules={modules} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "目标业务分类" })).toHaveTextContent("电源");
    expect(screen.getByRole("button", { name: "确认移动" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "目标业务分类" }));
    const tree = screen.getByRole("tree");
    expect(within(tree).queryByRole("button", { name: "健康" })).not.toBeInTheDocument();
    fireEvent.click(within(tree).getByRole("button", { name: "根级（无父模块）" }));
    fireEvent.click(screen.getByRole("button", { name: "确认移动" }));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("retains a changed target when leaving is cancelled, then blocks every close while submitting", () => {
    const onCancel = vi.fn();
    const props = { module: child, modules, onCancel, onConfirm: vi.fn() };
    const view = render(<ModuleMoveDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "目标业务分类" }));
    fireEvent.click(within(screen.getByRole("tree")).getByRole("button", { name: "根级（无父模块）" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("dialog", { name: "放弃移动设置？" })).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("button", { name: "目标业务分类" })).toHaveTextContent("根级");
    view.rerender(<ModuleMoveDialog {...props} busy />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "移动「电池」" })).toBeInTheDocument();
  });
});
