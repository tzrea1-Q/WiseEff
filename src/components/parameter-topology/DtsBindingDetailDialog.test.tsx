import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { selectControlOption } from "@/test/selectControlOption";
import { describe, expect, it, vi } from "vitest";

import { formatAuditAbsoluteTime } from "@/domain/audit/formatAuditTime";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

import { DtsBindingDetailDialog } from "./DtsBindingDetailDialog";

function gpioRow(overrides: Partial<DtsParameterWorkbenchRow> = {}): DtsParameterWorkbenchRow {
  return {
    bindingId: "binding-gpio-int",
    parameterSpecId: "spec-gpio-int",
    parameterSpecVersionId: "spec-version-gpio-int-v3",
    logicalNodeId: "logical-sc8562-6e",
    propertyKey: "gpio_int",
    driverModule: "sc8562",
    compatible: "vendor,sc8562",
    instanceName: "sc8562@6E",
    moduleId: "module:charge",
    moduleName: "充电策略",
    modulePath: ["电源", "充电策略"],
    importance: "high",
    moduleSortOrder: 0,
    moduleMapped: true,
    unitAddress: "6E",
    topologyPath: "/amba/i2c@FDF5E000/sc8562@6E",
    topologyNodeId: "effective-sc8562-6e",
    sourceOccurrenceId: "occurrence-gpio-int",
    sourceFileName: "board-power.dtsi",
    sourceNodePath: "/amba/i2c@FDF5E000/sc8562@6E",
    sourceLine: 27,
    rawValue: "<&gpio13 29 0>",
    effectiveValue: {
      kind: "cells",
      bits: 32,
      groups: [[
        { kind: "phandle", label: "gpio13" },
        { kind: "integer", raw: "29", value: "29" },
        { kind: "integer", raw: "0", value: "0" }
      ]]
    },
    valueShapeSummary: "phandle-list · 32 bit · 3 cells",
    schemaState: "valid",
    policyState: "pass",
    mappingOpen: true,
    governanceState: "attention",
    effects: [
      {
        id: "effect-base",
        propertyName: "gpio_int",
        effectKind: "set",
        nodeOccurrenceId: "occurrence-base",
        propertyOccurrenceId: "property-base",
        sourceOrder: 1
      },
      {
        id: "effect-overlay",
        propertyName: "gpio_int",
        effectKind: "override",
        nodeOccurrenceId: "occurrence-overlay",
        propertyOccurrenceId: "property-overlay",
        sourceOrder: 4
      }
    ],
    searchText: "gpio_int sc8562 sc8562@6e gpio13",
    view: "effective",
    nodeEnablement: null,
    nodeEnablementNotice: null,
    ...overrides
  };
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof DtsBindingDetailDialog>> = {}) {
  const props: React.ComponentProps<typeof DtsBindingDetailDialog> = { row: gpioRow(), canEdit: false, onClose: vi.fn(), ...overrides };
  return { ...render(<DtsBindingDetailDialog {...props} />), props };
}
function field(container: HTMLElement, label: string): HTMLElement {
  return within(container).getByText(label).closest("div") as HTMLElement;
}
function openTab(name: string) { fireEvent.mouseDown(screen.getByRole("tab", { name })); }
const specDetail = {
  id: "spec-gpio-int", sourceKind: "dts" as const, specificationKey: "vendor/sc8562/gpio_int", propertyKey: "gpio_int",
  driverModule: "sc8562", lifecycle: "active" as const, currentVersionId: "spec-version-current-v4", currentVersion: 4,
  displayName: "GPIO 中断", description: "当前版本的展示描述。", valueShape: { kind: "phandle-list" },
  schemaDefault: null, exampleValue: "<&gpio13 29 0>", schemaNamespace: "vendor/sc8562", units: null,
  constraints: { cells: 3 }, documentation: "当前版本的参数说明。", compatiblePatterns: ["vendor,sc8562"], attributionModules: [], policyTarget: null
};

describe("DtsBindingDetailDialog unified inspector", () => {
  it.each(["first line\nsecond line", "a".repeat(240), "short string"])("edits single strings as DTS source without stripping their original value (case %#)", (text) => {
    const rawValue = JSON.stringify(text);
    const onDraftChange = vi.fn();
    const view = renderDialog({ canEdit: true, onDraftChange, onSaveDraft: vi.fn(), row: gpioRow({ rawValue, effectiveValue: { kind: "strings", values: [text] } }) });
    const editor = screen.getByRole("textbox", { name: "目标值" });
    expect(editor.tagName).toBe("TEXTAREA");
    expect(editor).toHaveValue(rawValue);
    const nextRaw = JSON.stringify(`${text}\nlast line`);
    fireEvent.change(editor, { target: { value: nextRaw } });
    expect(onDraftChange).toHaveBeenCalledWith({ rawValue: nextRaw, reason: "", action: "set" });
    view.rerender(<DtsBindingDetailDialog {...view.props} draft={{ rawValue: '"short"', reason: "", action: "set" }} />);
    expect(screen.getByRole("textbox", { name: "目标值" }).tagName).toBe("TEXTAREA");
    expect(screen.getByRole("textbox", { name: "目标值" })).toHaveValue('"short"');
  });

  it("shows current published meaning while retaining pinned units and constraints", () => {
    const latestDefinition = {
      definitionId: "canonical-gpio", propertyKey: "gpio_int", revisionId: "revision-new",
      revisionNumber: 5, contentDigest: "sha256:new", displayName: "最新名称",
      documentation: "后台刚刚修改的说明", unit: "mV",
      valueShape: { kind: "json-schema", schema: { type: "integer" } },
      constraints: { kind: "none" }, catalogReleaseId: "release-new", examples: ["<3>"]
    };
    renderDialog({
      row: gpioRow({ definitionId: "canonical-gpio", effectiveRevisionId: "revision-old", documentation: "项目旧说明" }),
      latestStatus: "ready", latestDefinition,
      specDetailStatus: "ready", specDetail
    });
    const dialog = screen.getByRole("dialog", { name: "最新名称 · 参数详情" });
    expect(within(dialog).getByText("后台刚刚修改的说明")).toBeInTheDocument();
    expect(within(dialog).queryByText("项目旧说明")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/项目合同仍固定于 revision-old/)).toBeInTheDocument();
    expect(within(dialog).getByText("最新目录示例（仅供参考）")).toBeInTheDocument();
    expect(field(dialog, "约束")).toHaveTextContent("每组 3 项");
  });

  it("prioritizes pinned description and documentation and exposes definition before technical identity", () => {
    renderDialog({ row: gpioRow({ description: "固定版本的展示描述。", documentation: "固定版本的参数说明。" }), specDetail, specDetailStatus: "ready" });
    const dialog = screen.getByRole("dialog", { name: "GPIO 中断 · 参数详情" });
    expect(dialog.parentElement).toHaveClass("modal-backdrop", "dts-binding-detail-dialog__overlay");
    expect(dialog).toHaveClass("parameter-inspector");
    const definition = within(dialog).getByRole("heading", { name: "参数定义" }).closest("section")!;
    expect(within(definition).getByText("固定版本的展示描述。")).toBeInTheDocument();
    expect(within(definition).getByText("固定版本的参数说明。")).toBeInTheDocument();
    expect(within(definition).queryByText("当前版本的展示描述。")).not.toBeInTheDocument();
    expect(within(definition).queryByText("当前版本的参数说明。")).not.toBeInTheDocument();
    expect(field(definition, "当前值")).toHaveTextContent("<&gpio13 29 0>");
    expect(field(definition, "示例值（示意，非推荐）")).toHaveTextContent("<&gpio13 29 0>");
    expect(field(definition, "约束")).toHaveTextContent("每组 3 项");
    expect(field(definition, "所属模块")).toHaveTextContent("电源 / 充电策略");
    expect(field(definition, "重要性")).toHaveTextContent("高");
    expect(within(dialog).queryByText("binding-gpio-int")).not.toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "加入草稿" })).not.toBeInTheDocument();
  });

  it("keeps four associated tab panels and the footer in one modal", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    const tabs = within(dialog).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["配置", "变更历史", "跨项目对比", "配置来源"]);
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute("aria-controls")!);
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
      expect(panel).toHaveAttribute("role", "tabpanel");
    }
    for (const name of ["变更历史", "跨项目对比", "配置来源", "配置"]) {
      openTab(name);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.getByRole("tabpanel", { name })).toBeVisible();
      expect(within(dialog).getByRole("button", { name: "关闭" })).toBeVisible();
    }
  });

  it("uses clean empty states and localized loading/error retry surfaces in their own tabs", () => {
    const onRetryHistory = vi.fn(); const onRetryCompare = vi.fn(); const onRetrySpecDetail = vi.fn();
    const view = renderDialog();
    openTab("变更历史"); expect(screen.getByText("暂无历史记录。")).toBeVisible();
    openTab("跨项目对比"); expect(screen.getByText("暂无其他项目的对比数据。")).toBeVisible();
    view.rerender(<DtsBindingDetailDialog {...view.props} historyStatus="loading" compareStatus="loading" specDetailStatus="loading" />);
    expect(screen.getByText("正在加载对比…")).toBeVisible();
    openTab("变更历史"); expect(screen.getByText("正在加载历史…")).toBeVisible();
    openTab("配置"); expect(screen.getByText("正在加载规格详情…")).toBeVisible();
    view.rerender(<DtsBindingDetailDialog {...view.props} historyStatus="error" compareStatus="error" specDetailStatus="error"
      onRetryHistory={onRetryHistory} onRetryCompare={onRetryCompare} onRetrySpecDetail={onRetrySpecDetail} />);
    fireEvent.click(screen.getByRole("button", { name: "重试规格详情" })); expect(onRetrySpecDetail).toHaveBeenCalledOnce();
    openTab("变更历史"); fireEvent.click(screen.getByRole("button", { name: "重试历史" })); expect(onRetryHistory).toHaveBeenCalledOnce();
    openTab("跨项目对比"); fireEvent.click(screen.getByRole("button", { name: "重试对比" })); expect(onRetryCompare).toHaveBeenCalledOnce();
  });

  it("shows ordered inline history diff, reason, actor and exact revision identities in disclosures", () => {
    renderDialog({ historyEntries: [
      { id: "rev-3", changedAt: "2026-01-03T00:00:00.000Z", fromRawValue: "<1>", toRawValue: "<2>", actor: "陈晨", reason: "调整中断配置", definitionRevisionId: "definition-revision-12", effectiveRevisionId: "effective-revision-13", currentValueId: "value-3" },
      { id: "rev-1", changedAt: "2026-01-01T00:00:00.000Z", fromRawValue: null, toRawValue: "<0>", definitionRevisionId: "revision-14", effectiveRevisionId: "revision-14" }
    ] });
    openTab("变更历史");
    const panel = screen.getByRole("tabpanel", { name: "变更历史" });
    const entries = within(panel).getAllByRole("article");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveAccessibleName("历史事件 1 历史差异");
    expect(entries[0]).toHaveTextContent(formatAuditAbsoluteTime("2026-01-03T00:00:00.000Z"));
    expect(entries[0]).toHaveTextContent("陈晨");
    expect(entries[0]).toHaveTextContent("调整中断配置");
    expect(entries[0]).not.toHaveTextContent("2026-01-03T00:00:00.000Z");
    expect(within(entries[0]!).getByText("<1>")).toBeVisible();
    expect(within(entries[0]!).getByText("<2>")).toBeVisible();
    const technical = within(entries[0]!).getByText("技术信息").closest("details")!;
    expect(technical).not.toHaveAttribute("open");
    fireEvent.click(within(technical).getByText("技术信息"));
    expect(technical).toHaveTextContent("值的固定修订 definition-revision-12");
    expect(technical).toHaveTextContent("事件有效修订 effective-revision-13");
    expect(technical).toHaveTextContent("value-3");
    expect(entries[1]).toHaveTextContent("修订 revision-14");
    expect(entries[1]).not.toHaveTextContent("值的固定修订");
    expect(entries[1]).not.toHaveTextContent("事件有效修订");
    expect(within(entries[1]!).getByText("尚未配置")).toBeVisible();
    expect(within(entries[1]!).getByText("<0>")).toBeVisible();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("retains exact source binding identity and makes source/debug actions available inside the source tab", () => {
    const onOpenSource = vi.fn(); const onStartDtsReload = vi.fn();
    renderDialog({ onOpenSource, onStartDtsReload, row: gpioRow({ definitionId: "canonical-definition", effectiveRevisionId: "exact-effective-revision" }) });
    openTab("配置来源");
    const panel = screen.getByRole("tabpanel", { name: "配置来源" });
    expect(field(panel, "来源文件")).toHaveTextContent("board-power.dtsi");
    expect(field(panel, "节点路径")).toHaveTextContent("/amba/i2c@FDF5E000/sc8562@6E");
    expect(field(panel, "源码行")).toHaveTextContent("27");
    expect(within(panel).getByText("gpio_int = <&gpio13 29 0>;")).toBeVisible();
    const details = within(panel).getByText("技术详情").closest("details")!;
    expect(details).not.toHaveAttribute("open"); fireEvent.click(within(details).getByText("技术详情"));
    expect(field(details, "绑定标识")).toHaveTextContent("binding-gpio-int");
    expect(field(details, "定义标识")).toHaveTextContent("canonical-definition");
    expect(field(details, "固定修订")).toHaveTextContent("exact-effective-revision");
    expect(field(details, "来源实例")).toHaveTextContent("occurrence-gpio-int");
    fireEvent.click(screen.getByRole("button", { name: "在源码中定位" })); expect(onOpenSource).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "带入 DTS 调试" })); expect(onStartDtsReload).toHaveBeenCalledOnce();
  });

  it("compares exact peer instances inline and references a selected value without stacked dialogs", async () => {
    const onUseCompareAsDraft = vi.fn();
    renderDialog({ canEdit: true, baseProjectId: "proj-source", row: gpioRow({ rawValue: "<3590>" }), onUseCompareAsDraft,
      compareEntries: [
        { bindingId: "binding-aurora-1", projectId: "proj-aurora", projectName: "Aurora 量产平台", rawValue: "<3590>", displayLocator: "/charger0" },
        { bindingId: "binding-aurora-2", projectId: "proj-aurora", projectName: "Aurora 量产平台", rawValue: "<3600>", displayLocator: "/charger1" },
        { bindingId: "binding-nebula-1", projectId: "proj-nebula", projectName: "Nebula 高频调试项目", rawValue: "<3500>" }
      ] });
    openTab("跨项目对比");
    const panel = screen.getByRole("tabpanel", { name: "跨项目对比" });
    expect(within(panel).getByText("1 相同 · 2 不同")).toBeVisible();
    expect(within(panel).getByLabelText("对比目标配置实例")).toHaveAttribute("data-value", "");
    expect(within(panel).getAllByText("请选择配置实例")).toHaveLength(1);
    expect(within(panel).queryByText("请选择要比较的配置实例")).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Aurora 量产平台.*charger0/ })).toBeVisible();
    expect(within(panel).getByRole("button", { name: /Aurora 量产平台.*charger1/ })).toBeVisible();
    await selectControlOption(within(panel).getByLabelText("对比目标配置实例"), "binding-nebula-1");
    fireEvent.click(within(panel).getByRole("button", { name: "使用该项目配置加入草稿" }));
    expect(onUseCompareAsDraft).toHaveBeenCalledWith({ rawValue: "<3500>", reason: "参考 Nebula 高频调试项目 当前配置生成草稿" });
    expect(screen.getByRole("tabpanel", { name: "配置" })).toBeVisible();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("requires explicit replacement when a comparison would overwrite local input", () => {
    const onUseCompareAsDraft = vi.fn();
    renderDialog({ canEdit: true, hasLocalChanges: true, onUseCompareAsDraft,
      compareEntries: [{ bindingId: "peer", projectId: "peer-project", projectName: "参考项目", rawValue: "<5>" }] });
    openTab("跨项目对比");
    const referenceButton = screen.getByRole("button", { name: "使用该项目配置加入草稿" });
    referenceButton.focus(); fireEvent.click(referenceButton);
    const confirm = screen.getByRole("dialog", { name: "替换未保存的修改？" });
    expect(onUseCompareAsDraft).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "替换未保存的修改？" })).not.toBeInTheDocument();
    expect(onUseCompareAsDraft).not.toHaveBeenCalled();
    expect(referenceButton).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "使用该项目配置加入草稿" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "替换未保存的修改？" })).getByRole("button", { name: "引用并替换" }));
    expect(onUseCompareAsDraft).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(confirm).not.toBeInTheDocument();
  });

  it("hides mutation controls when no authoring callbacks exist for a read-only user", () => {
    renderDialog({ canEdit: false });
    expect(screen.queryByRole("textbox", { name: "目标值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();
  });

  it("keeps focus contained, ignores unpaired backdrop release and restores focus on dismissal", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>打开详情</button>{open ? <DtsBindingDetailDialog row={gpioRow()} canEdit={false} onClose={() => setOpen(false)} /> : null}</>;
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开详情" }); trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "gpio_int · 参数详情" });
    expect(dialog).toHaveAccessibleDescription("gpio_int当前项目 · sc8562@6E");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const first = within(dialog).getByRole("button", { name: "关闭参数详情" });
    const last = within(dialog).getByRole("button", { name: "关闭" });
    last.focus(); fireEvent.keyDown(dialog, { key: "Tab" }); expect(first).toHaveFocus();
    first.focus(); fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true }); expect(last).toHaveFocus();
    const backdrop = dialog.parentElement!;
    fireEvent.pointerDown(dialog); fireEvent.pointerUp(backdrop); expect(dialog).toBeInTheDocument();
    fireEvent.pointerDown(backdrop); fireEvent.pointerUp(backdrop); expect(dialog).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
    fireEvent.click(trigger); fireEvent.keyDown(window, { key: "Escape" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  });
});
