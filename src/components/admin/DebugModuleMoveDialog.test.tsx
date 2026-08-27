import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import { DebugModuleMoveDialog } from "./DebugModuleMoveDialog";

const moduleNodes: FlatModuleNode[] = [
  { id: "power", name: "电源", parentId: null, path: "power", depth: 1 },
  { id: "battery", name: "电池", parentId: "power", path: "power/battery", depth: 2 },
  { id: "battery-health", name: "电池健康", parentId: "battery", path: "power/battery/battery-health", depth: 3 },
  { id: "charging", name: "充电", parentId: null, path: "charging", depth: 1 }
];

afterEach(() => {
  cleanup();
});

describe("DebugModuleMoveDialog", () => {
  it("shows the current path, excludes the module subtree, and supports moving to root", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(
      <DebugModuleMoveDialog
        module={moduleNodes[1]!}
        modules={moduleNodes}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "移动「电池」" });
    expect(within(dialog).getByText("当前位置：电源 / 电池")).toBeInTheDocument();

    const confirm = within(dialog).getByRole("button", { name: "确认移动" });
    expect(confirm).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "目标父模块" }));
    const tree = screen.getByRole("tree", { name: "目标父模块树形选项" });
    expect(within(tree).getByRole("button", { name: "根级（无父模块）" })).toBeInTheDocument();
    expect(within(tree).getByRole("button", { name: "充电" })).toBeInTheDocument();
    expect(within(tree).queryByRole("button", { name: "电池健康" })).not.toBeInTheDocument();

    fireEvent.click(within(tree).getByRole("button", { name: "根级（无父模块）" }));
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(null));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open and reports a failed move", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("request failed"));
    const onCancel = vi.fn();

    render(
      <DebugModuleMoveDialog
        module={moduleNodes[0]!}
        modules={moduleNodes}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "移动「电源」" });
    fireEvent.click(within(dialog).getByRole("button", { name: "目标父模块" }));
    fireEvent.click(within(screen.getByRole("tree", { name: "目标父模块树形选项" })).getByRole("button", { name: "充电" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "确认移动" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("移动模块失败，请重试。");
    expect(screen.getByRole("dialog", { name: "移动「电源」" })).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
