import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DebugParameterNodeBinding } from "@/domain/debugging/types";
import { DebugParameterBindingsDialog } from "./DebugParameterBindingsDialog";

function buildBindings(): DebugParameterNodeBinding[] {
  return [
    { protocol: "hdc", nodePath: "/sys/hdc/fast_charge", accessMode: "RW", enabled: true, notes: "primary" },
    { protocol: "adb", nodePath: "/sys/adb/fast_charge", accessMode: "RO", enabled: false, notes: "fallback" }
  ];
}

describe("DebugParameterBindingsDialog", () => {
  it("renders HDC and ADB binding panels", () => {
    render(
      <DebugParameterBindingsDialog
        parameterName="快充电流限制"
        draft={buildBindings()}
        parameterId="dbg-1"
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

    expect(screen.getByRole("dialog", { name: "快充电流限制 路径绑定" })).toBeInTheDocument();
    expect(screen.getByLabelText("HDC 节点路径")).toBeInTheDocument();
    expect(screen.getByLabelText("ADB 节点路径")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("calls onSave from footer action", () => {
    const onSave = vi.fn();
    render(
      <DebugParameterBindingsDialog
        parameterName="快充电流限制"
        draft={buildBindings()}
        parameterId="dbg-1"
        isApiMode
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

  it("opens access mode select options", async () => {
    const { user } = await import("@testing-library/user-event").then((mod) => ({
      user: mod.default.setup()
    }));

    render(
      <DebugParameterBindingsDialog
        parameterName="快充电流限制"
        draft={buildBindings()}
        parameterId="dbg-1"
        isApiMode={false}
        canEdit
        loading={false}
        onBindingChange={vi.fn()}
        onSave={vi.fn()}
        onSaveBinding={vi.fn()}
        onArchiveBinding={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole("combobox", { name: "HDC 访问模式" }));
    expect(await screen.findByRole("option", { name: "RW · 读写" })).toBeInTheDocument();
  });

  it("calls save callback for protocol action", () => {
    const onSaveBinding = vi.fn();
    render(
      <DebugParameterBindingsDialog
        parameterName="快充电流限制"
        draft={buildBindings()}
        parameterId="dbg-1"
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
});
