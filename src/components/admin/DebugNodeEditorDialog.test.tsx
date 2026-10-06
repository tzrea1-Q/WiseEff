import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DebugNodeEditorDialog } from "./DebugNodeEditorDialog";
import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";
import type { ParameterRepository } from "@/application/ports/ParameterRepository";

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
  const canonicalBinding = { projectId: "project-a", bindingId: "binding-a", expectedEffectiveRevisionId: "revision-a", expectedCurrentValueId: "value-a", sourcePinId: "source-a" };
  const parameterRepository = {
    listProjects: vi.fn().mockResolvedValue([{ id: "project-a", name: "项目甲" }]),
    listParameters: vi.fn().mockResolvedValue([
      { projectId: "project-a", bindingId: "binding-a", effectiveRevisionId: "revision-a", currentValueId: "value-a", name: "温度", module: "电池" },
      { projectId: "project-a", bindingId: "incomplete", name: "缺少版本" },
      { projectId: "other-project", bindingId: "foreign", effectiveRevisionId: "revision-a", currentValueId: "value-a", name: "其他项目" }
    ])
  } as unknown as Pick<ParameterRepository, "listProjects" | "listParameters">;

  it("selects only real project bindings with both exact revision and value pins", async () => {
    const onSave = vi.fn();
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={node} open parameterRepository={parameterRepository} onSave={onSave} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("关联项目")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("关联项目"), { target: { value: "project-a" } });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await screen.findByRole("option", { name: "温度 · 电池" });
    expect(parameterRepository.listParameters).toHaveBeenCalledWith({ projectId: "project-a" });
    expect(screen.queryByRole("option", { name: /缺少版本|其他项目/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("关联参数"), { target: { value: "binding-a" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ canonicalBinding: {
      projectId: "project-a", bindingId: "binding-a", expectedEffectiveRevisionId: "revision-a", expectedCurrentValueId: "value-a"
    } }));
  });

  it("preserves an existing association and allows explicit unlink", async () => {
    const onSave = vi.fn();
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={{ ...node, canonicalBinding }} open parameterRepository={parameterRepository} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ canonicalBinding }));
    await waitFor(() => expect(screen.getByLabelText("关联项目")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("关联项目"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ canonicalBinding: null }));
  });

  it("keeps standalone metadata editable when protected reads fail", async () => {
    const onSave = vi.fn();
    const failed = { ...parameterRepository, listProjects: vi.fn().mockRejectedValue(new Error("denied")) };
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={node} open parameterRepository={failed} onSave={onSave} onClose={vi.fn()} />);
    await screen.findByText("无法加载可关联的项目参数，请重新选择项目重试。");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ canonicalBinding: undefined }));
  });
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

  it("keeps the module tree menu inside the editor selector contract", () => {
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

    const dialog = screen.getByRole("dialog", { name: "编辑节点" });
    const trigger = within(dialog).getByRole("button", { name: "模块", expanded: false });
    fireEvent.click(trigger);

    expect(dialog).toHaveClass("debug-admin-definition-dialog");
    expect(trigger).toHaveClass("module-tree-trigger");
    expect(within(dialog).getByRole("tree")).toHaveClass("dropdown-menu", "module-tree-menu");
  });
});
