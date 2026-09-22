import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectParameterBinding } from "@/domain/parameter-topology/types";
import type { ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";
import { JsonBindingPanel } from "./JsonBindingPanel";

const jsonBinding: ProjectParameterBinding = {
  id: "binding-json-1",
  parameterSpecId: "spec-json-1",
  parameterSpecVersionId: "spec-json-v1",
  propertyKey: "charging-policy",
  driverModule: "charging",
  logicalNodeId: "node-1",
  instanceName: "charger0",
  locator: "/charger0",
  effectiveValue: { kind: "json", value: { kind: "cells", values: [1, 2] } },
  rawValue: '{"kind":"cells","values":[1,2]}',
  schemaState: "valid",
  policyState: "pass",
  moduleId: "module-charging"
};

const secondBinding: ProjectParameterBinding = {
  id: "binding-json-2",
  parameterSpecId: "spec-json-2",
  parameterSpecVersionId: "spec-json-v2",
  propertyKey: "battery-limits",
  driverModule: "bms",
  logicalNodeId: "node-2",
  instanceName: "bms0",
  locator: "/bms0",
  effectiveValue: { kind: "json", value: { maxTemp: 45 } },
  rawValue: '{"maxTemp":45}',
  schemaState: "valid",
  policyState: "pass",
  moduleId: "module-bms"
};

const moduleRegistry: ParameterModuleRegistry = {
  modules: [
    {
      id: "module-charging",
      name: "充电管理",
      parentId: null,
      sortOrder: 1,
      description: "充电控制与策略",
      scope: "system",
      importance: "high",
      kind: "business",
      origin: "curated",
      sourceKey: null,
      effectiveImportance: "high",
      parameterCount: 1,
      definitionCount: 1
    },
    {
      id: "module-bms",
      name: "电池管理",
      parentId: null,
      sortOrder: 2,
      description: "电池保护与状态监测",
      scope: "system",
      importance: "high",
      kind: "business",
      origin: "curated",
      sourceKey: null,
      effectiveImportance: "high",
      parameterCount: 1,
      definitionCount: 1
    }
  ]
};

describe("JsonBindingPanel", () => {
  it("renders module navigation, parameter table and no download buttons in table rows", () => {
    render(
      <JsonBindingPanel
        bindings={[jsonBinding, secondBinding]}
        moduleRegistry={moduleRegistry}
        canEdit
      />
    );

    expect(screen.getByRole("region", { name: "模块导航" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "JSON 参数列表" })).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "JSON 参数列表" });
    expect(within(table).getAllByRole("button", { name: /^查看 / })).toHaveLength(2);
    expect(within(table).getAllByRole("button", { name: /^编辑 / })).toHaveLength(2);

    // Requirement 3: table rows must NOT contain export/download options
    expect(within(table).queryByRole("button", { name: /导出|下载/ })).not.toBeInTheDocument();
  });

  it("filters parameters when a module tree node is selected in module navigation", () => {
    render(
      <JsonBindingPanel
        bindings={[jsonBinding, secondBinding]}
        moduleRegistry={moduleRegistry}
        canEdit
      />
    );

    const table = screen.getByRole("table", { name: "JSON 参数列表" });
    expect(within(table).getByText("charging-policy")).toBeInTheDocument();
    expect(within(table).getByText("battery-limits")).toBeInTheDocument();

    // Click on the "充电管理" tree item to filter
    const moduleItem = screen.getByRole("treeitem", { name: /充电管理/ });
    fireEvent.click(moduleItem);

    expect(within(table).getByText("charging-policy")).toBeInTheDocument();
    expect(within(table).queryByText("battery-limits")).not.toBeInTheDocument();
  });

  it("opens edit dialog on edit button click and validates draft submission", async () => {
    const onValidateEdit = vi.fn().mockResolvedValue({ valid: true, diagnostics: [] });

    render(
      <JsonBindingPanel
        bindings={[jsonBinding]}
        canEdit
        onValidateEdit={onValidateEdit}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑 charging-policy" }));

    const dialog = screen.getByRole("dialog", { name: "修改草稿" });
    expect(dialog).toBeVisible();

    fireEvent.change(within(dialog).getByLabelText("目标值"), {
      target: { value: '{"kind":"cells","values":[4,5]}' }
    });
    fireEvent.change(within(dialog).getByLabelText("修改原因"), {
      target: { value: "校准充电策略" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "校验并创建草稿" }));

    await waitFor(() => {
      expect(onValidateEdit).toHaveBeenCalledWith({
        bindingId: "binding-json-1",
        rawValue: '{"kind":"cells","values":[4,5]}',
        reason: "校准充电策略"
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "修改草稿" })).not.toBeInTheDocument();
    });
  });

  it("opens detail dialog on view click, exposes history/export actions and transitions to draft dialog", async () => {
    const onExportBinding = vi.fn().mockResolvedValue(undefined);
    const onLoadHistory = vi.fn().mockResolvedValue([
      {
        id: "history-1",
        reason: "校准充电策略",
        createdAt: "2026-09-17T01:02:03.000Z",
        oldCurrentValueId: "value-old",
        newCurrentValueId: "value-new",
        valueState: "present"
      },
      {
        id: "history-delete-1",
        reason: "移除过时属性",
        createdAt: "2026-09-18T01:02:03.000Z",
        oldCurrentValueId: "value-new",
        newCurrentValueId: null,
        valueState: "deleted"
      }
    ]);

    render(
      <JsonBindingPanel
        bindings={[jsonBinding]}
        canEdit
        onExportBinding={onExportBinding}
        onLoadHistory={onLoadHistory}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看 charging-policy" }));

    const detailDialog = screen.getByRole("dialog", { name: "charging-policy 参数详情" });
    expect(detailDialog).toBeVisible();

    // Export action inside detail dialog
    fireEvent.click(within(detailDialog).getByRole("button", { name: "导出源文件" }));
    await waitFor(() => expect(onExportBinding).toHaveBeenCalledWith("binding-json-1"));

    // History action inside detail dialog
    fireEvent.click(within(detailDialog).getByRole("button", { name: "查看固定值历史" }));
    await waitFor(() => expect(onLoadHistory).toHaveBeenCalledWith("binding-json-1"));
    expect(await within(detailDialog).findByText(/校准充电策略/)).toBeVisible();
    expect(await within(detailDialog).findByText(/删除属性 · 移除过时属性/)).toBeVisible();

    // Transition from detail to edit dialog
    fireEvent.click(within(detailDialog).getByRole("button", { name: "编辑此参数" }));
    expect(screen.queryByRole("dialog", { name: "charging-policy 参数详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "修改草稿" })).toBeVisible();
  });

  it("does not render DTS bindings in the JSON surface", () => {
    const dtsBinding = { ...jsonBinding, id: "binding-dts", effectiveValue: { kind: "empty", present: true } as const };
    const { container } = render(<JsonBindingPanel bindings={[dtsBinding]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("creates a delete draft with a reason and no target value from edit dialog", async () => {
    const onValidateEdit = vi.fn().mockResolvedValue({ valid: true, diagnostics: [] });
    render(
      <JsonBindingPanel
        bindings={[jsonBinding]}
        canEdit
        onValidateEdit={onValidateEdit}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑 charging-policy" }));
    const dialog = screen.getByRole("dialog", { name: "修改草稿" });

    fireEvent.change(within(dialog).getByLabelText("修改原因"), {
      target: { value: "移除过时属性" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建删除草稿" }));

    await waitFor(() => expect(onValidateEdit).toHaveBeenCalledWith({
      bindingId: "binding-json-1",
      rawValue: "",
      action: "delete",
      reason: "移除过时属性"
    }));
  });

  it("shows localized source errors linked to the JSON value input in edit dialog", async () => {
    render(
      <JsonBindingPanel
        bindings={[jsonBinding]}
        canEdit
        onValidateEdit={async () => ({
          valid: false,
          diagnostics: [{ code: "VALIDATION_FAILED", message: "JSON draft target is invalid or unsupported." }]
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑 charging-policy" }));
    const dialog = screen.getByRole("dialog", { name: "修改草稿" });

    fireEvent.change(within(dialog).getByLabelText("目标值"), { target: { value: "not-json" } });
    fireEvent.change(within(dialog).getByLabelText("修改原因"), { target: { value: "校验错误提示" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "校验并创建草稿" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("目标值未通过校验");
    expect(alert).not.toHaveTextContent("JSON draft target");
    expect(within(dialog).getByLabelText("目标值")).toHaveAttribute("aria-describedby", alert.id);
    expect(within(dialog).getByLabelText("目标值")).toHaveAttribute("aria-invalid", "true");
  });

  it("filters parameters via search input and shows match count badge", () => {
    render(<JsonBindingPanel bindings={[jsonBinding, secondBinding]} />);

    const table = screen.getByRole("table", { name: "JSON 参数列表" });
    expect(screen.getByText("共 2 项")).toBeInTheDocument();
    expect(within(table).getByText("charging-policy")).toBeInTheDocument();
    expect(within(table).getByText("battery-limits")).toBeInTheDocument();

    const searchInput = screen.getByRole("searchbox", { name: "搜索 JSON 参数" });
    fireEvent.change(searchInput, { target: { value: "battery" } });

    expect(screen.getByText("匹配 1 / 2 项")).toBeInTheDocument();
    expect(within(table).getByText("battery-limits")).toBeInTheDocument();
    expect(within(table).queryByText("charging-policy")).not.toBeInTheDocument();
  });

  it("renders draft badge when binding is present in draftBindingIds", () => {
    render(
      <JsonBindingPanel
        bindings={[jsonBinding]}
        draftBindingIds={new Set(["binding-json-1"])}
      />
    );
    expect(screen.getByText("草稿")).toBeInTheDocument();
  });

  it("renders header action buttons: 参数列表, JSON 源码, 导出当前结果", () => {
    const handleExport = vi.fn();
    render(
      <JsonBindingPanel
        bindings={[jsonBinding, secondBinding]}
        moduleRegistry={moduleRegistry}
        onExportRows={handleExport}
      />
    );

    const group = screen.getByRole("group", { name: "结果模式" });
    expect(within(group).getByRole("button", { name: "参数列表" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "JSON 源码" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "导出当前结果" })).toBeInTheDocument();

    // Default mode is parameters list
    expect(within(group).getByRole("button", { name: "参数列表" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "JSON 源码" })).toHaveAttribute("aria-pressed", "false");

    // Clicking "导出当前结果" calls onExportRows with filtered bindings
    fireEvent.click(within(group).getByRole("button", { name: "导出当前结果" }));
    expect(handleExport).toHaveBeenCalledWith([jsonBinding, secondBinding]);
  });

  it("switches to JSON source view with loadPrimaryJsonSource, displays viewer and 下载 JSON button", async () => {
    const loadPrimaryJsonSource = vi.fn().mockResolvedValue({
      fileName: "custom-config.json",
      versionNumber: 3,
      text: '{\n  "charging-policy": {\n    "kind": "cells"\n  }\n}'
    });

    render(
      <JsonBindingPanel
        bindings={[jsonBinding, secondBinding]}
        moduleRegistry={moduleRegistry}
        loadPrimaryJsonSource={loadPrimaryJsonSource}
      />
    );

    const group = screen.getByRole("group", { name: "结果模式" });
    fireEvent.click(within(group).getByRole("button", { name: "JSON 源码" }));

    // Verify view mode updated
    expect(within(group).getByRole("button", { name: "JSON 源码" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "参数列表" })).toHaveAttribute("aria-pressed", "false");

    // "下载 JSON" button appears in place of "导出当前结果"
    expect(await within(group).findByRole("button", { name: "下载 JSON" })).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: "导出当前结果" })).not.toBeInTheDocument();

    // Search bar adapts to source code find mode
    expect(screen.getByRole("searchbox", { name: "在 JSON 源码中查找" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("在 JSON 文本中查找")).toBeInTheDocument();

    // JSON source viewer renders with custom aria label and content
    expect(await screen.findByLabelText("JSON 源码")).toBeInTheDocument();
    expect(screen.getByLabelText("custom-config.json · v3")).toBeInTheDocument();
    expect(loadPrimaryJsonSource).toHaveBeenCalledTimes(1);

    // Switching back to "参数列表" restores table mode
    fireEvent.click(within(group).getByRole("button", { name: "参数列表" }));
    expect(within(group).getByRole("button", { name: "参数列表" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "JSON 参数列表" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "导出当前结果" })).toBeInTheDocument();
  });

  it("synthesizes JSON source when loadPrimaryJsonSource is not provided", async () => {
    render(
      <JsonBindingPanel
        bindings={[jsonBinding, secondBinding]}
        moduleRegistry={moduleRegistry}
        projectName="aurora"
      />
    );

    const group = screen.getByRole("group", { name: "结果模式" });
    fireEvent.click(within(group).getByRole("button", { name: "JSON 源码" }));

    expect(await screen.findByLabelText("JSON 源码")).toBeInTheDocument();
    expect(screen.getByLabelText("aurora.json · v1")).toBeInTheDocument();
    expect(screen.getByText(/"charging-policy"/)).toBeInTheDocument();
  });

  it("jumps and highlights line when module node is clicked in JSON source mode", async () => {
    const jsonText = '{\n  "header": true,\n  "charging-policy": {\n    "kind": "cells"\n  },\n  "battery-limits": {\n    "maxTemp": 45\n  }\n}';
    render(
      <JsonBindingPanel
        bindings={[jsonBinding, secondBinding]}
        moduleRegistry={moduleRegistry}
        loadPrimaryJsonSource={async () => ({
          fileName: "power.json",
          versionNumber: 1,
          text: jsonText
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "JSON 源码" }));
    expect(await screen.findByLabelText("JSON 源码")).toBeInTheDocument();

    // Click module "充电管理" in module navigator
    const moduleItem = screen.getByRole("treeitem", { name: /充电管理/ });
    fireEvent.click(moduleItem);

    // Line 3 contains "charging-policy" and should be focused
    await waitFor(() => {
      const lineGutter = screen.getByText("3", { selector: ".project-primary-dts-viewer__line-number" });
      const row = lineGutter.closest(".project-primary-dts-viewer__line");
      expect(row).toHaveClass("is-focused");
    });
  });

  it("handles downloading JSON file via 下载 JSON button", async () => {
    const createObjectURLMock = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURLMock = vi.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;

    render(
      <JsonBindingPanel
        bindings={[jsonBinding]}
        projectName="aurora"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "JSON 源码" }));
    const downloadBtn = await screen.findByRole("button", { name: "下载 JSON" });

    fireEvent.click(downloadBtn);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");
  });
});

