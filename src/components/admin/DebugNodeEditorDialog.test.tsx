import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { DebugNodeEditorDialog } from "./DebugNodeEditorDialog";
import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";
import type { ParameterRepository } from "@/application/ports/ParameterRepository";
import { createParameterCatalogClient } from "@/infrastructure/http/parameterCatalogClient";
import { createApiParameterCatalogRepository } from "@/application/parameter-catalog/apiAdapter";

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

async function chooseOption(label: string, option: string) {
  const user = userEvent.setup();
  const section = screen.getByLabelText(label).closest("details");
  if (section && !section.open) fireEvent.click(section.querySelector("summary")!);
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("DebugNodeEditorDialog", () => {
  const canonicalBinding = { projectId: "project-a", bindingId: "binding-a", expectedEffectiveRevisionId: "revision-a", expectedCurrentValueId: "value-a", sourcePinId: "source-a" };
  const parameterRepository = {
    listProjects: vi.fn().mockResolvedValue([{ id: "project-a", name: "项目甲", code: "A" }, { id: "project-b", name: "项目乙", code: "B" }]),
    listParameters: vi.fn().mockResolvedValue([])
  } satisfies Pick<ParameterRepository, "listProjects" | "listParameters">;
  const binding = {
    projectId: "project-a", id: "binding-a", effectiveRevisionId: "revision-a", currentValueId: "value-a",
    parameterSpecId: "definition-a", parameterSpecVersionId: "revision-a", definitionId: "definition-a",
    propertyKey: "temperature", driverModule: "电池", logicalNodeId: null, instanceName: null,
    locator: "/limit", effectiveValue: { kind: "json", value: 36.5 }, rawValue: "36.5\n",
    schemaState: "valid", policyState: "not_applicable", moduleId: "mod-a", displayName: "温度",
    description: null, documentation: null
  };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const secondProject = String(input).includes("/projects/project-b/");
    const item = secondProject ? { ...binding, projectId: "project-b", id: "binding-b", effectiveRevisionId: "revision-b", currentValueId: "value-b" } : binding;
    return new Response(JSON.stringify({ items: [item,
      { ...item, id: "incomplete", currentValueId: undefined, displayName: "缺少版本" },
      { ...item, id: "foreign", projectId: "other-project", displayName: "其他项目" }
    ] }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const parameterCatalogRepository = createApiParameterCatalogRepository(createParameterCatalogClient({ fetchImpl }));

  it("selects only real project bindings with both exact revision and value pins", async () => {
    const onSave = vi.fn();
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={node} open parameterRepository={parameterRepository} parameterCatalogRepository={parameterCatalogRepository} onSave={onSave} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("关联项目")).toBeEnabled());
    await chooseOption("关联项目", "项目甲");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("关联参数")).toBeEnabled());
    await userEvent.setup().click(screen.getByLabelText("关联参数"));
    await screen.findByRole("option", { name: "温度 · /limit" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v2/projects/project-a/parameter-bindings", expect.objectContaining({ method: "GET" }));
    expect(screen.queryByRole("option", { name: /缺少版本|其他项目/ })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("option", { name: "温度 · /limit" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ canonicalBinding: {
      projectId: "project-a", bindingId: "binding-a", expectedEffectiveRevisionId: "revision-a", expectedCurrentValueId: "value-a"
    } }));
    await chooseOption("关联项目", "项目乙");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("关联参数")).toHaveAttribute("data-value", "");
    await waitFor(() => expect(screen.getByLabelText("关联参数")).toBeEnabled());
    await userEvent.setup().click(screen.getByLabelText("关联参数"));
    await screen.findByRole("option", { name: "温度 · /limit" });
    expect(screen.queryByRole("option", { name: /当前关联参数|缺少版本|其他项目/ })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("option", { name: "温度 · /limit" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ canonicalBinding: {
      projectId: "project-b", bindingId: "binding-b", expectedEffectiveRevisionId: "revision-b", expectedCurrentValueId: "value-b"
    } }));
    expect(parameterRepository.listParameters).not.toHaveBeenCalled();
  });

  it("preserves an existing association and allows explicit unlink", async () => {
    const onSave = vi.fn();
    const staleReader = { listProtectedProjectBindings: vi.fn().mockResolvedValue({ items: [] }) };
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={{ ...node, canonicalBinding }} open parameterRepository={parameterRepository} parameterCatalogRepository={staleReader} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ canonicalBinding }));
    await waitFor(() => expect(screen.getByLabelText("关联项目")).toBeEnabled());
    expect(screen.getByLabelText("关联参数")).toHaveAttribute("data-value", "binding-a");
    expect(screen.getByLabelText("关联参数")).toHaveTextContent("当前关联参数");
    await chooseOption("关联项目", "不关联项目参数");
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
  it.each(["missing", "denied"])("keeps the existing association when the canonical reader is %s, without a legacy fallback", async (failure) => {
    const onSave = vi.fn();
    const reader = failure === "missing" ? {} : { listProtectedProjectBindings: vi.fn().mockRejectedValue(new Error("denied")) };
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={{ ...node, canonicalBinding }} open parameterRepository={parameterRepository} parameterCatalogRepository={reader} onSave={onSave} onClose={vi.fn()} />);
    await screen.findByText("无法加载可关联的项目参数，请重新选择项目重试。");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ canonicalBinding }));
    expect(parameterRepository.listParameters).not.toHaveBeenCalled();
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

  it("resolves an API node's module name without replacing explicit module identities", () => {
    const onSave = vi.fn();
    const view = render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={{ ...node, moduleId: undefined }} open onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("button", { name: "模块" })).toHaveTextContent("Battery Health");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ moduleId: "mod-a" }));
    view.rerender(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={{ ...node, id: "other-node", moduleId: "unknown-module" }} open onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByText("请选择有效模块后保存。")).toBeInTheDocument();
  });

  it("keeps dirty drafts on Escape and cancel until discard is explicitly confirmed", () => {
    const onClose = vi.fn();
    render(<DebugNodeEditorDialog canEdit loading={false} mode="create" moduleNodes={moduleNodes} open onClose={onClose} onSave={vi.fn()} />);
    expect(screen.getByText("请填写节点名称。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "new node" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "放弃未保存的更改？" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("名称")).toHaveValue("new node");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃并关闭" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("filters a large binding list while retaining the selected canonical pins", async () => {
    const onSave = vi.fn();
    const items = Array.from({ length: 120 }, (_, index) => ({ ...binding, id: `binding-${index}`, displayName: `参数 ${index}` }));
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={node} open parameterRepository={parameterRepository} parameterCatalogRepository={{ listProtectedProjectBindings: vi.fn().mockResolvedValue({ items }) }} onSave={onSave} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("关联项目")).toBeEnabled());
    await chooseOption("关联项目", "项目甲");
    await waitFor(() => expect(screen.getByLabelText("关联参数")).toBeEnabled());
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索关联参数" }), { target: { value: "参数 119" } });
    await userEvent.setup().click(screen.getByLabelText("关联参数"));
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await userEvent.setup().click(screen.getByRole("option", { name: "参数 119 · /limit" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索关联参数" }), { target: { value: "does-not-match" } });
    expect(screen.getByLabelText("关联参数")).toHaveAttribute("data-value", "binding-119");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ canonicalBinding: { projectId: "project-a", bindingId: "binding-119", expectedEffectiveRevisionId: "revision-a", expectedCurrentValueId: "value-a" } }));
  });

  it("keeps pending edits safe and reports failed saves inside the dialog", () => {
    const onClose = vi.fn();
    render(<DebugNodeEditorDialog canEdit loading mode="edit" moduleNodes={moduleNodes} node={node} open error="保存失败，请重试。" onClose={onClose} onSave={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("保存失败，请重试。");
  });

  it("shows both protocol rows and saves a new node with no bindings, then sends only a newly configured protocol", async () => {
    const onSave = vi.fn();
    render(<DebugNodeEditorDialog canEdit loading={false} mode="create" moduleNodes={moduleNodes} open onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByLabelText("HDC 节点路径")).toBeVisible();
    expect(screen.getByLabelText("ADB 节点路径")).toBeVisible();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "new node" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ bindings: [], archiveProtocols: [] }));
    fireEvent.change(screen.getByLabelText("HDC 节点路径"), { target: { value: " /sys/new/value " } });
    await chooseOption("HDC 访问模式", "WO · 只写");
    fireEvent.click(screen.getByLabelText("启用 HDC 协议"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ bindings: [{ protocol: "hdc", nodePath: "/sys/new/value", accessMode: "WO", enabled: true, notes: "" }], archiveProtocols: [] }));
  });

  it("sends only genuinely changed protocols and retains disabled paths and notes", () => {
    const onSave = vi.fn();
    const savedNode = { ...node, bindings: [...node.bindings.map((binding) => ({ ...binding, notes: "primary" })), { protocol: "adb" as const, nodePath: "/sys/adb/temp", accessMode: "RW" as const, enabled: false }] };
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={savedNode} open onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("ADB 节点路径"), { target: { value: " /sys/adb/temp " } });
    fireEvent.click(screen.getByLabelText("启用 HDC 协议"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ bindings: [{ ...savedNode.bindings[0], enabled: false }], archiveProtocols: [] }));
  });

  it.each(["relative/path", ""])("rejects an invalid existing protocol path %j and focuses its inline error", (nodePath) => {
    const onSave = vi.fn();
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={node} open onClose={vi.fn()} onSave={onSave} />);
    const path = screen.getByLabelText("HDC 节点路径");
    fireEvent.change(path, { target: { value: nodePath } });
    fireEvent.blur(path);
    expect(path).toHaveAttribute("aria-invalid", "true");
    expect(path).toHaveAccessibleDescription(nodePath ? "节点路径必须以 / 开头。" : "节点路径不能为空。");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(path).toHaveFocus();
  });

  it("requires a path for enabled, annotated, or access-mode-changed new protocols", async () => {
    const onSave = vi.fn();
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={node} open onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByLabelText("启用 ADB 协议"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("ADB 节点路径")).toHaveFocus();
    fireEvent.click(screen.getByLabelText("启用 ADB 协议"));
    fireEvent.click(screen.getByRole("button", { name: "ADB 更多配置" }));
    fireEvent.change(screen.getByLabelText("ADB 备注"), { target: { value: "needs a path" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("ADB 备注"), { target: { value: "" } });
    await chooseOption("ADB 访问模式", "RW · 读写");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("ADB 节点路径")).toHaveFocus();
  });

  it("confirms archival as a reversible draft change, preserving sibling edits and restoring the archived protocol's saved values", () => {
    const onSave = vi.fn();
    const savedNode = { ...node, bindings: [{ ...node.bindings[0]!, notes: "saved note" }] };
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={savedNode} open onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("HDC 节点路径"), { target: { value: "/unsaved/hdc" } });
    fireEvent.change(screen.getByLabelText("ADB 节点路径"), { target: { value: "/unsaved/adb" } });
    fireEvent.click(screen.getByRole("button", { name: "HDC 更多配置" }));
    fireEvent.change(screen.getByLabelText("HDC 备注"), { target: { value: "unsaved note" } });
    fireEvent.click(screen.getByRole("button", { name: "归档 HDC 绑定" }));
    const confirmation = screen.getByRole("dialog", { name: "归档 HDC 绑定？" });
    expect(confirmation).toHaveTextContent("放弃此协议尚未保存的修改");
    fireEvent.click(within(confirmation).getByRole("button", { name: "取消" }));
    expect(screen.getByLabelText("HDC 节点路径")).toHaveValue("/unsaved/hdc");
    fireEvent.click(screen.getByRole("button", { name: "归档 HDC 绑定" }));
    fireEvent.click(screen.getByRole("button", { name: "标记待归档" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("HDC 节点路径")).toHaveValue(node.bindings[0]!.nodePath);
    expect(screen.getByLabelText("HDC 备注")).toHaveValue("saved note");
    expect(screen.getByLabelText("HDC 节点路径")).toBeDisabled();
    expect(screen.getByLabelText("ADB 节点路径")).toHaveValue("/unsaved/adb");
    fireEvent.click(screen.getByRole("button", { name: "撤销 HDC 归档" }));
    expect(screen.getByLabelText("HDC 节点路径")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ bindings: [{ protocol: "adb", nodePath: "/unsaved/adb", accessMode: "RO", enabled: false, notes: "" }], archiveProtocols: [] }));
    fireEvent.click(screen.getByRole("button", { name: "归档 HDC 绑定" }));
    fireEvent.click(screen.getByRole("button", { name: "标记待归档" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ bindings: [{ protocol: "adb", nodePath: "/unsaved/adb", accessMode: "RO", enabled: false, notes: "" }], archiveProtocols: ["hdc"] }));
  });

  it("retains the complete draft after a failed unified save and blocks all editing and dismissal while pending", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const props = { canEdit: true, mode: "edit" as const, moduleNodes, node, open: true, onSave, onClose };
    const view = render(<DebugNodeEditorDialog {...props} loading={false} />);
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "changed name" } });
    fireEvent.change(screen.getByLabelText("ADB 节点路径"), { target: { value: "/new/adb" } });
    fireEvent.click(screen.getByRole("button", { name: "HDC 更多配置" }));
    fireEvent.click(screen.getByRole("button", { name: "归档 HDC 绑定" }));
    fireEvent.click(screen.getByRole("button", { name: "标记待归档" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const submittedDraft = onSave.mock.calls[0]![0];
    view.rerender(<DebugNodeEditorDialog {...props} loading />);
    expect(screen.getByLabelText("ADB 节点路径")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "ADB 访问模式" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    const backdrop = screen.getByRole("dialog", { name: "编辑节点" }).parentElement!;
    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(<DebugNodeEditorDialog {...props} loading={false} error="保存失败，全部变更未写入。" />);
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(screen.getByLabelText("名称")).toHaveValue("changed name");
    expect(screen.getByLabelText("ADB 节点路径")).toHaveValue("/new/adb");
    expect(screen.getByRole("button", { name: "撤销 HDC 归档" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenLastCalledWith(submittedDraft);
  });

  it("protects protocol-only edits and restores focus when the discard confirmation is cancelled", () => {
    const onClose = vi.fn();
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={node} open onClose={onClose} onSave={vi.fn()} />);
    const path = screen.getByLabelText("ADB 节点路径");
    fireEvent.change(path, { target: { value: "/draft/adb" } });
    path.focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(path).toHaveFocus();
    expect(path).toHaveValue("/draft/adb");
  });

  it("includes the project choice in dirty state and expands and focuses missing association errors on submit", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(<DebugNodeEditorDialog canEdit loading={false} mode="edit" moduleNodes={moduleNodes} node={{ ...node, canonicalBinding: null }} open parameterRepository={parameterRepository} parameterCatalogRepository={parameterCatalogRepository} onClose={onClose} onSave={onSave} />);
    await waitFor(() => expect(screen.getByLabelText("关联项目")).toBeEnabled());
    await chooseOption("关联项目", "项目甲");
    await waitFor(() => expect(screen.getByLabelText("关联参数")).toBeEnabled());
    const section = screen.getByLabelText("关联参数").closest("details")!;
    fireEvent.click(section.querySelector("summary")!);
    expect(section.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(section.open).toBe(true);
    expect(screen.getByLabelText("关联参数")).toHaveFocus();
    expect(screen.getByLabelText("关联参数")).toHaveAccessibleDescription("请选择关联参数，或取消项目关联。");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "放弃未保存的更改？" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps read-only protocol controls disabled while allowing a clean close", () => {
    const onClose = vi.fn();
    render(<DebugNodeEditorDialog canEdit={false} loading={false} mode="edit" moduleNodes={moduleNodes} node={node} open onClose={onClose} onSave={vi.fn()} />);
    expect(screen.getByLabelText("名称")).toBeDisabled();
    expect(screen.getByLabelText("HDC 节点路径")).toBeDisabled();
    expect(screen.getByLabelText("启用 HDC 协议")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "HDC 访问模式" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
