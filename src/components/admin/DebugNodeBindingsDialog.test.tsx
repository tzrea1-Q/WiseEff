import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DebugNodeProtocolBinding } from "@/domain/debugging/types";
import { DebugNodeBindingsDialog } from "./DebugNodeBindingsDialog";

function buildBindings(): DebugNodeProtocolBinding[] {
  return [
    { protocol: "hdc", nodePath: "/sys/hdc/fast_charge", accessMode: "RW", enabled: true, notes: "primary" },
    { protocol: "adb", nodePath: "/sys/adb/fast_charge", accessMode: "RO", enabled: false, notes: "fallback" }
  ];
}

describe("DebugNodeBindingsDialog", () => {
  it("renders HDC and ADB binding panels", () => {
    render(
      <DebugNodeBindingsDialog
        nodeName="快充电流限制"
        draft={buildBindings()}
        nodeId="node-1"
        isApiMode
        canEdit
        loading={false}
        onBindingChange={vi.fn()}
        onSave={vi.fn()}
        onSaveBinding={vi.fn()}
        onArchiveBinding={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "快充电流限制" })).toBeInTheDocument();
    expect(screen.getByLabelText("HDC 节点路径")).toBeInTheDocument();
    expect(screen.getByLabelText("ADB 节点路径")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("calls onSave from footer action in mock mode", () => {
    const onSave = vi.fn();
    render(
      <DebugNodeBindingsDialog
        nodeName="快充电流限制"
        draft={buildBindings()}
        nodeId="node-1"
        isApiMode={false}
        canEdit
        loading={false}
        onBindingChange={vi.fn()}
        onSave={onSave}
        onSaveBinding={vi.fn()}
        onArchiveBinding={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("calls save callback for protocol action", () => {
    const onSaveBinding = vi.fn();
    render(
      <DebugNodeBindingsDialog
        nodeName="快充电流限制"
        draft={buildBindings()}
        nodeId="node-1"
        isApiMode
        canEdit
        loading={false}
        onBindingChange={vi.fn()}
        onSave={vi.fn()}
        onSaveBinding={onSaveBinding}
        onArchiveBinding={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "保存 HDC binding" }));
    expect(onSaveBinding).toHaveBeenCalledWith("hdc");
  });

  it("allows changing the HDC access mode from the modal", async () => {
    const onBindingChange = vi.fn();
    const user = (await import("@testing-library/user-event")).default.setup();

    render(
      <DebugNodeBindingsDialog
        nodeName="快充电流限制"
        draft={buildBindings()}
        nodeId="node-1"
        isApiMode
        canEdit
        loading={false}
        onBindingChange={onBindingChange}
        onSave={vi.fn()}
        onSaveBinding={vi.fn()}
        onArchiveBinding={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole("combobox", { name: "HDC 访问模式" }));
    await user.click(await screen.findByRole("option", { name: "WO · 只写" }));

    expect(onBindingChange).toHaveBeenCalledWith("hdc", { accessMode: "WO" });
  });

  it("disables protocol save when node path is invalid", () => {
    render(
      <DebugNodeBindingsDialog
        nodeName="快充电流限制"
        draft={[{ protocol: "hdc", nodePath: "relative/path", accessMode: "RW", enabled: true }]}
        nodeId="node-1"
        isApiMode
        canEdit
        loading={false}
        onBindingChange={vi.fn()}
        onSave={vi.fn()}
        onSaveBinding={vi.fn()}
        onArchiveBinding={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const hdcPathInput = screen.getByLabelText("HDC 节点路径");
    fireEvent.blur(hdcPathInput);

    expect(screen.getByText("节点路径必须以 / 开头。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存 HDC binding" })).toBeDisabled();
  });
});
