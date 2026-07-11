import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DebugNodeEditorDialog } from "./DebugNodeEditorDialog";
import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";

const moduleNodes = [
  { id: "mod-a", name: "Battery Health", parentId: null, path: "mod-a", depth: 1 }
] as const;

const node: DebugNodeRegistryEntry = {
  id: "node-1",
  name: "battery_temp",
  description: "电池温度",
  detailedDescription: "读取电池温度节点",
  writeFormatExample: "3100",
  writeFormatHint: "",
  module: "Battery Health",
  moduleId: "mod-a",
  enabled: true,
  bindings: [{ protocol: "hdc", nodePath: "/sys/battery/temp", accessMode: "RO", enabled: true }]
};

describe("DebugNodeEditorDialog", () => {
  it("shows save actions in the edit dialog footer", () => {
    render(
      <DebugNodeEditorDialog
        canEdit
        loading={false}
        mode="edit"
        moduleNodes={moduleNodes}
        node={node}
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("calls onSave when the save button is clicked", () => {
    const onSave = vi.fn();
    render(
      <DebugNodeEditorDialog
        canEdit
        loading={false}
        mode="edit"
        moduleNodes={moduleNodes}
        node={node}
        open
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "battery_temp",
        moduleId: "mod-a"
      })
    );
  });
});
