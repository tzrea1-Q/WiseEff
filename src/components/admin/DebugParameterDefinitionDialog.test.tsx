import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DebugAdminParameterDraft } from "@/domain/debugging/types";
import { DebugParameterDefinitionDialog } from "./DebugParameterDefinitionDialog";

function buildDraft(): DebugAdminParameterDraft {
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
    bindings: []
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
