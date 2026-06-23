import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DebugAdminParameterDraft } from "@/domain/debugging/types";
import { DebugParameterDefinitionDialog } from "./DebugParameterDefinitionDialog";

function buildDraft(overrides: Partial<DebugAdminParameterDraft> = {}): DebugAdminParameterDraft {
  return {
    id: "dbg-1",
    projectId: null,
    name: "快充电流限制",
    key: "debug.fast_charge_limit",
    description: "",
    module: "Diagnostics",
    currentValue: "1200",
    targetValue: "1250",
    unit: "mA",
    range: "800-1600",
    minValue: null,
    maxValue: null,
    risk: "High",
    nodePath: "/sys/class/power",
    accessMode: "RW",
    sortOrder: 1,
    enabled: true,
    bindings: [],
    valueKind: "scalar",
    valueFormat: "raw",
    normalizationMode: "trim",
    maxValueBytes: null,
    ...overrides
  };
}

describe("DebugParameterDefinitionDialog", () => {
  it("shows key editor fields", () => {
    render(
      <DebugParameterDefinitionDialog
        draft={buildDraft()}
        isApiMode
        canEdit
        loading={false}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "调试参数定义编辑" })).toBeInTheDocument();
    expect(screen.getByLabelText("调试目标值")).toBeInTheDocument();
    expect(screen.getByText("标识信息")).toBeInTheDocument();
    expect(screen.getByLabelText("值类型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  });

  it("calls onSave when saving", () => {
    const onSave = vi.fn();
    render(
      <DebugParameterDefinitionDialog
        draft={buildDraft()}
        isApiMode
        canEdit
        loading={false}
        onDraftChange={vi.fn()}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("renders complex multiline editors for complex parameters", () => {
    render(
      <DebugParameterDefinitionDialog
        draft={buildDraft({
          valueKind: "complex",
          valueFormat: "dts",
          normalizationMode: "exact",
          currentValue: "fragment {\n  key = <1>;\n};",
          targetValue: "fragment {\n  key = <2>;\n};"
        })}
        isApiMode
        canEdit
        loading={false}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const currentEditor = screen.getByLabelText("当前值");
    const targetEditor = screen.getByLabelText("调试目标值");
    expect(currentEditor.tagName).toBe("TEXTAREA");
    expect(targetEditor.tagName).toBe("TEXTAREA");
    expect(currentEditor).toHaveAttribute("wrap", "off");
    expect(targetEditor).toHaveAttribute("wrap", "off");
    expect(screen.getByLabelText("值格式")).toBeInTheDocument();
    expect(screen.getByLabelText("规范化模式")).toBeInTheDocument();
  });

  it("blocks save and shows JSON validation error for invalid complex JSON", () => {
    const onSave = vi.fn();
    render(
      <DebugParameterDefinitionDialog
        draft={buildDraft({
          valueKind: "complex",
          valueFormat: "json",
          normalizationMode: "json-canonical",
          currentValue: '{"ok":true}',
          targetValue: "{not-json"
        })}
        isApiMode
        canEdit
        loading={false}
        onDraftChange={vi.fn()}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("值必须是有效的 JSON。")).toBeInTheDocument();
  });

  it("does not show runtime status field in mock mode", () => {
    render(
      <DebugParameterDefinitionDialog
        draft={buildDraft()}
        isApiMode={false}
        canEdit
        loading={false}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByLabelText("状态")).not.toBeInTheDocument();
    expect(screen.queryByText("已同步")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <DebugParameterDefinitionDialog
        draft={buildDraft()}
        isApiMode
        canEdit
        loading={false}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
