import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    fireEvent.change(screen.getByLabelText("关联项目"), { target: { value: "project-a" } });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await screen.findByRole("option", { name: "温度 · /limit" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v2/projects/project-a/parameter-bindings", expect.objectContaining({ method: "GET" }));
    expect(screen.queryByRole("option", { name: /缺少版本|其他项目/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("关联参数"), { target: { value: "binding-a" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ canonicalBinding: {
      projectId: "project-a", bindingId: "binding-a", expectedEffectiveRevisionId: "revision-a", expectedCurrentValueId: "value-a"
    } }));
    fireEvent.change(screen.getByLabelText("关联项目"), { target: { value: "project-b" } });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByLabelText("关联参数")).toHaveValue("");
    await screen.findByRole("option", { name: "温度 · /limit" });
    expect(screen.queryByRole("option", { name: /当前关联参数|缺少版本|其他项目/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("关联参数"), { target: { value: "binding-b" } });
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
    expect(screen.getByRole("option", { name: "当前关联参数" })).toHaveValue("binding-a");
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
});
