import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DebugModuleManagementDialog, type DebugModuleManagementDialogProps } from "./DebugModuleManagementDialog";

const modules = [{ id: "power", name: "电源", path: "power", parentId: null, depth: 1 }];
function props(overrides: Partial<DebugModuleManagementDialogProps> = {}): DebugModuleManagementDialogProps {
  return {
    open: true, moduleNodes: modules, nodes: [], canEdit: true,
    onClose: vi.fn(), onAddModule: vi.fn(), onUpdateModule: vi.fn(), onMoveModule: vi.fn(),
    onDeleteModule: vi.fn(), onEditNode: vi.fn(), onDeleteNode: vi.fn(), ...overrides
  };
}

describe("DebugModuleManagementDialog", () => {
  it("shows one editor at a time and returns to the preserved module search after save and refresh", async () => {
    const user = userEvent.setup();
    const settings = props();
    const { rerender } = render(<DebugModuleManagementDialog {...settings} />);
    await user.type(screen.getByRole("searchbox", { name: "搜索模块" }), "电源");
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "模块管理" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "电源" })).toHaveAccessibleDescription(/节点模块/);
    fireEvent.change(screen.getByLabelText("模块展示描述"), { target: { value: "新的描述" } });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(settings.onUpdateModule).toHaveBeenCalledWith("power", { name: "电源", description: "新的描述", scope: "" });
    rerender(<DebugModuleManagementDialog {...settings} moduleNodes={[{ ...modules[0]!, description: "新的描述" }]} />);
    expect(screen.getByRole("searchbox", { name: "搜索模块" })).toHaveValue("电源");
    expect(screen.getByText("新的描述")).toBeInTheDocument();
  });

  it("retains a failed create draft and blocks dismissal and duplicate writes while pending", async () => {
    const user = userEvent.setup();
    let reject!: (failure: Error) => void;
    const onAddModule = vi.fn(() => new Promise<void>((_resolve, rejectSave) => { reject = rejectSave; }));
    const settings = props({ onAddModule });
    render(<DebugModuleManagementDialog {...settings} />);
    await user.click(screen.getByRole("button", { name: "新增根模块" }));
    await user.type(screen.getByLabelText("模块名称"), "电池");
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "新增根模块" })).toBeInTheDocument();
    expect(onAddModule).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("已填写的内容会保留");
    expect(screen.getByLabelText("模块名称")).toHaveValue("电池");
    expect(screen.getByRole("button", { name: "创建" })).toBeEnabled();
  });

  it("keeps node deletion in overflow and preserves the confirmation callback", async () => {
    const user = userEvent.setup();
    const settings = props({ nodes: [{
      id: "cycle", name: "循环次数", description: "电池循环计数", detailedDescription: "", writeFormatExample: "", writeFormatHint: "",
      module: "电源", moduleId: "power", enabled: true, bindings: []
    }] });
    render(<DebugModuleManagementDialog {...settings} />);
    await user.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getByText("循环次数").tagName).toBe("STRONG");
    expect(screen.queryByRole("button", { name: "删除节点" })).not.toBeInTheDocument();
    const nodeActions = screen.getByRole("group", { name: "电源 条目操作" });
    await user.click(within(nodeActions).getByRole("button", { name: /更多/ }));
    await user.click(screen.getByRole("menuitem", { name: "删除节点" }));
    expect(settings.onDeleteNode).toHaveBeenCalledWith("cycle");
  });
});
