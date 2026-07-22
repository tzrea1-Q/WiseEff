import { fireEvent, render, screen, within } from "@testing-library/react";
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
    ...overrides
  };
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof DtsBindingDetailDialog>> = {}) {
  const props: React.ComponentProps<typeof DtsBindingDetailDialog> = {
    row: gpioRow(),
    canEdit: true,
    onClose: vi.fn(),
    onAddToDraft: vi.fn(),
    ...overrides
  };
  return { ...render(<DtsBindingDetailDialog {...props} />), props };
}

function field(container: HTMLElement, label: string): HTMLElement {
  return within(container).getByText(label).closest("div") as HTMLElement;
}

describe("DtsBindingDetailDialog", () => {
  it("shows read-only definition, DTS location, history, compare, and folded technical identity", () => {
    renderDialog({
      specDetail: {
        id: "spec-gpio-int",
        sourceKind: "dts",
        specificationKey: "vendor/sc8562/gpio_int",
        propertyKey: "gpio_int",
        driverModule: "sc8562",
        lifecycle: "active",
        currentVersionId: "spec-version-gpio-int-v3",
        currentVersion: 3,
        displayName: "GPIO 中断",
        description: "SC8562 中断 GPIO 说明符。",
        valueShape: { kind: "phandle-list" },
        schemaDefault: null,
        exampleValue: "<&gpio13 29 0>",
        schemaNamespace: "vendor/sc8562",
        units: null,
        constraints: { cells: 3 },
        documentation: "电荷泵中断引脚的 phandle-list 配置，通常为 3 个 cell。",
        compatiblePatterns: ["vendor,sc8562"],
        policyTarget: null
      },
      specDetailStatus: "ready"
    });

    const dialog = screen.getByRole("dialog", { name: "gpio_int 参数详情" });
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass(
      "dts-binding-detail-dialog__overlay"
    );
    for (const heading of ["参数定义", "近期历史", "跨项目对比"]) {
      expect(within(dialog).getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(within(dialog).queryByRole("heading", { name: "DTS 位置" })).not.toBeInTheDocument();

    expect(within(dialog).queryByText(/充电策略 · sc8562@6E · sc8562 · 重要性 高/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("电荷泵中断引脚的 phandle-list 配置，通常为 3 个 cell。")).toBeInTheDocument();
    const definition = within(dialog).getByRole("heading", { name: "参数定义" }).closest("section") as HTMLElement;
    expect(field(definition, "当前值")).toHaveTextContent("<&gpio13 29 0>");
    expect(within(definition).queryByText("生效值")).not.toBeInTheDocument();
    expect(field(definition, "示例值（示意，非推荐）")).toHaveTextContent("<&gpio13 29 0>");
    expect(field(definition, "约束")).toHaveTextContent("cells=3");
    expect(within(definition).queryByText("值形态")).not.toBeInTheDocument();
    expect(within(definition).queryByText("治理状态")).not.toBeInTheDocument();
    expect(field(definition, "所属模块")).toHaveTextContent("电源 / 充电策略");
    expect(field(definition, "重要性")).toHaveTextContent("高");
    expect(within(definition).getByText("GPIO 中断")).toBeInTheDocument();

    expect(within(dialog).queryByRole("heading", { name: "类型化编辑" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("来源链")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("技术身份")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("binding-gpio-int")).not.toBeInTheDocument();
  });

  it("shows a clean empty history message without any phase-1 placeholder wording", () => {
    renderDialog({ historyEntries: [] });

    const history = within(screen.getByRole("dialog", { name: "gpio_int 参数详情" }))
      .getByRole("heading", { name: "近期历史" })
      .closest("section") as HTMLElement;
    expect(within(history).getByText("暂无历史记录。")).toBeInTheDocument();
    expect(within(history).queryByText(/阶段一占位/)).not.toBeInTheDocument();
  });

  it("renders binding-revision history entries newest-first with mature list cards", () => {
    renderDialog({
      historyEntries: [
        { id: "rev-3", changedAt: "2026-01-03T00:00:00.000Z", fromRawValue: "<1>", toRawValue: "<2>", actor: "xu.yun" },
        { id: "rev-1", changedAt: "2026-01-01T00:00:00.000Z", fromRawValue: null, toRawValue: "<0>" }
      ]
    });

    const history = screen.getByRole("list", { name: "参数历史" });
    const entries = within(history).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(within(entries[0]!).getByText("R2")).toBeInTheDocument();
    expect(within(entries[0]!).getByText("<2>")).toBeInTheDocument();
    expect(entries[0]).toHaveTextContent(formatAuditAbsoluteTime("2026-01-03T00:00:00.000Z"));
    expect(entries[0]).toHaveTextContent("xu.yun");
    expect(entries[0]).not.toHaveTextContent("2026-01-03T00:00:00.000Z");
    expect(within(entries[1]!).getByText("R1")).toBeInTheDocument();
    expect(within(entries[1]!).getByText("<0>")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看历史差异" })).toBeInTheDocument();
  });

  it("opens history diff dialog with from→to DiffCodeBlock cards", () => {
    renderDialog({
      historyEntries: [
        { id: "rev-3", changedAt: "2026-01-03T00:00:00.000Z", fromRawValue: "<1>", toRawValue: "<2>" },
        { id: "rev-1", changedAt: "2026-01-01T00:00:00.000Z", fromRawValue: null, toRawValue: "<0>" }
      ]
    });

    fireEvent.click(screen.getByRole("button", { name: "查看历史差异" }));
    const diffDialog = screen.getByRole("dialog", { name: "gpio_int 历史差异" });
    expect(within(diffDialog).getByLabelText("R2 历史差异")).toBeInTheDocument();
    expect(within(diffDialog).getByText("<1> → <2>")).toBeInTheDocument();
    expect(within(diffDialog).getByText("∅ → <0>")).toBeInTheDocument();
  });

  it("hides draft actions for read-only users", () => {
    renderDialog({ canEdit: false });

    const dialog = screen.getByRole("dialog", { name: "gpio_int 参数详情" });
    expect(within(dialog).queryByRole("textbox", { name: "目标值" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "加入草稿" })).not.toBeInTheDocument();
  });

  it("opens mature cross-project compare in a secondary dialog with dedupe and draft-from-target", () => {
    const onUseCompareAsDraft = vi.fn();
    renderDialog({
      row: gpioRow({ rawValue: "<3590>" }),
      baseProjectId: "proj-source",
      baseProjectName: "当前项目",
      onUseCompareAsDraft,
      compareEntries: [
        {
          projectId: "proj-aurora",
          projectName: "Aurora 量产平台",
          rawValue: "<3590>",
          moduleName: "batt",
          driverModule: "batt"
        },
        {
          projectId: "proj-aurora",
          projectName: "Aurora 量产平台",
          rawValue: "<3600>",
          moduleName: "batt",
          driverModule: "batt"
        },
        {
          projectId: "proj-nebula",
          projectName: "Nebula 高频调试项目",
          rawValue: "<3500>",
          moduleName: "batt"
        }
      ]
    });

    const detail = screen.getByRole("dialog", { name: "gpio_int 参数详情" });
    const entry = within(detail)
      .getByRole("heading", { name: "跨项目对比" })
      .closest("section") as HTMLElement;
    expect(within(entry).getByText(/3\/3 个项目已配置/)).toBeInTheDocument();
    expect(within(entry).queryByLabelText("对比目标项目")).not.toBeInTheDocument();

    fireEvent.click(within(entry).getByRole("button", { name: "打开跨项目对比" }));

    const compare = screen.getByRole("dialog", { name: "gpio_int 跨项目对比" });
    expect(within(compare).getByLabelText("对比目标项目")).toBeInTheDocument();
    expect(within(compare).queryByText("重点差异")).not.toBeInTheDocument();
    expect(within(compare).queryByText("差异视图")).not.toBeInTheDocument();
    expect(within(compare).queryByText("当前值对比")).not.toBeInTheDocument();
    expect(within(compare).getByLabelText("基准与目标项目")).toBeInTheDocument();

    const overview = within(compare).getByRole("list", { name: "跨项目对比" });
    expect(within(compare).getByText("1 相同 · 1 不同")).toBeInTheDocument();
    const entries = within(overview).getAllByRole("listitem").filter((item) => item.hasAttribute("data-kind"));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveAttribute("data-kind", "same");
    expect(entries[1]).toHaveAttribute("data-kind", "changed");
    expect(within(overview).queryByText("当前项目")).not.toBeInTheDocument();
    expect(within(entries[0]!).getByRole("button", { name: /Aurora 量产平台/ })).toBeInTheDocument();
    expect(within(entries[1]!).getByRole("button", { name: /Nebula 高频调试项目/ })).toBeInTheDocument();
    expect(within(overview).queryByText(/<3590>/)).not.toBeInTheDocument();

    fireEvent.click(within(entries[1]!).getByRole("button", { name: /Nebula 高频调试项目/ }));
    expect(within(compare).getByLabelText("对比目标项目")).toHaveValue("proj-nebula");

    fireEvent.change(within(compare).getByLabelText("对比目标项目"), {
      target: { value: "proj-nebula" }
    });
    expect(within(compare).getByLabelText("基准与目标项目")).toBeInTheDocument();

    fireEvent.click(within(compare).getByRole("button", { name: "使用该项目配置加入草稿" }));
    expect(onUseCompareAsDraft).toHaveBeenCalledWith({
      rawValue: "<3500>",
      reason: "参考 Nebula 高频调试项目 当前配置生成草稿"
    });
  });

  it("routes add-to-draft through the footer action", () => {
    const onAddToDraft = vi.fn();
    renderDialog({ onAddToDraft });

    fireEvent.click(screen.getByRole("button", { name: "加入草稿" }));
    expect(onAddToDraft).toHaveBeenCalledWith("binding-gpio-int");
  });
});
