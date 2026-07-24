import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type {
  EffectiveTopologyNode,
  SourceTopologyNode,
  TopologyView
} from "@/domain/parameter-topology/types";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

import { DtsParameterWorkbench } from "./DtsParameterWorkbench";

const sourceNodes: SourceTopologyNode[] = [
  sourceNode("source-root", null, "/"),
  sourceNode("source-amba", "source-root", "amba"),
  sourceNode("source-i2c", "source-amba", "i2c", "FDF5E000"),
  sourceNode("source-sc8562", "source-i2c", "sc8562-source", "6E"),
  sourceNode("source-sensor", "source-sc8562", "sensor", "1A"),
  sourceNode("source-mt5788", "source-i2c", "mt5788-source", "2B")
];

const effectiveNodes: EffectiveTopologyNode[] = [
  effectiveNode("effective-root", "logical-root", null, "/"),
  effectiveNode("effective-amba", "logical-amba", "logical-root", "amba"),
  effectiveNode("effective-i2c", "logical-i2c", "logical-amba", "i2c", "FDF5E000"),
  effectiveNode(
    "effective-sc8562",
    "logical-sc8562",
    "logical-i2c",
    "sc8562",
    "6E",
    "sc8562"
  ),
  effectiveNode(
    "effective-sensor",
    "logical-sensor",
    "logical-sc8562",
    "sensor",
    "1A",
    "vendor,sensor"
  ),
  effectiveNode(
    "effective-mt5788",
    "logical-mt5788",
    "logical-i2c",
    "mt5788",
    "2B",
    "mt,mt5788"
  )
];

const rowDefinitions = [
  {
    bindingId: "binding-gpio-int",
    propertyKey: "gpio_int",
    driverModule: "sc8562",
    rawValue: "<&gpio13 29 0>",
    governanceState: "attention" as const,
    effectiveNodeId: "effective-sc8562",
    sourceNodeId: "source-sc8562",
    effectivePath: "/amba/i2c@FDF5E000/sc8562@6E",
    sourcePath: "/amba/i2c@FDF5E000/sc8562-source@6E"
  },
  {
    bindingId: "binding-watchdog",
    propertyKey: "watchdog_time",
    driverModule: "sc8562",
    rawValue: "<5000>",
    governanceState: "valid" as const,
    effectiveNodeId: "effective-sc8562",
    sourceNodeId: "source-sc8562",
    effectivePath: "/amba/i2c@FDF5E000/sc8562@6E",
    sourcePath: "/amba/i2c@FDF5E000/sc8562-source@6E"
  },
  {
    bindingId: "binding-sensor-limit",
    propertyKey: "vendor,limit",
    driverModule: "sensor",
    rawValue: "<42>",
    governanceState: "blocked" as const,
    effectiveNodeId: "effective-sensor",
    sourceNodeId: "source-sensor",
    effectivePath: "/amba/i2c@FDF5E000/sc8562@6E/sensor@1A",
    sourcePath: "/amba/i2c@FDF5E000/sc8562-source@6E/sensor@1A"
  },
  {
    bindingId: "binding-rx-fod",
    propertyKey: "rx_fod_cond",
    driverModule: "mt5788",
    rawValue: "\"0\", \"-1\"",
    governanceState: "valid" as const,
    effectiveNodeId: "effective-mt5788",
    sourceNodeId: "source-mt5788",
    effectivePath: "/amba/i2c@FDF5E000/mt5788@2B",
    sourcePath: "/amba/i2c@FDF5E000/mt5788-source@2B"
  }
];

const effectiveRows = rowDefinitions.map((definition) => row(definition, "effective"));
const sourceRows = rowDefinitions.map((definition) => row(definition, "source"));

function sourceNode(
  id: string,
  parentOccurrenceId: string | null,
  name: string,
  unitAddress?: string
): SourceTopologyNode {
  return {
    id,
    fileVersionId: "file-version",
    fileName: "board.dts",
    parentOccurrenceId,
    name,
    unitAddress,
    labels: [],
    isOverlayRoot: false,
    nodePath: `/${id}`,
    startLine: 1,
    startColumn: 1,
    endLine: 2,
    endColumn: 1,
    contentHash: `hash-${id}`,
    sourceOrder: 1,
    properties: []
  };
}

function effectiveNode(
  id: string,
  logicalNodeId: string,
  parentLogicalNodeId: string | null,
  name: string,
  unitAddress?: string,
  compatible?: string
): EffectiveTopologyNode {
  return {
    id,
    logicalNodeId,
    locator: `/${id}`,
    name,
    unitAddress,
    compatible,
    parentLogicalNodeId,
    effects: []
  };
}

function row(
  definition: (typeof rowDefinitions)[number],
  view: TopologyView
): DtsParameterWorkbenchRow {
  const topologyNodeId = view === "source" ? definition.sourceNodeId : definition.effectiveNodeId;
  const topologyPath = view === "source" ? definition.sourcePath : definition.effectivePath;
  return {
    bindingId: definition.bindingId,
    parameterSpecId: `spec-${definition.bindingId}`,
    parameterSpecVersionId: `spec-version-${definition.bindingId}`,
    logicalNodeId: definition.effectiveNodeId.replace("effective-", "logical-"),
    propertyKey: definition.propertyKey,
    driverModule: definition.driverModule,
    compatible: `vendor,${definition.driverModule}`,
    instanceName: topologyPath.split("/").at(-1) ?? null,
    moduleId: `driver:${definition.driverModule}`,
    moduleName: `未分类 · ${definition.driverModule}`,
    modulePath: [`未分类 · ${definition.driverModule}`],
    importance: "medium",
    moduleSortOrder: Number.MAX_SAFE_INTEGER,
    moduleMapped: false,
    unitAddress: topologyPath.split("@").at(-1) ?? null,
    topologyPath,
    topologyNodeId,
    sourceOccurrenceId: definition.sourceNodeId,
    sourceFileName: "board.dts",
    sourceNodePath: definition.sourcePath,
    sourceLine: 20,
    rawValue: definition.rawValue,
    effectiveValue: definition.propertyKey === "gpio_int"
      ? {
          kind: "cells",
          bits: 32,
          groups: [[
            { kind: "phandle", label: "gpio13" },
            { kind: "integer", raw: "29", value: "29" },
            { kind: "integer", raw: "0", value: "0" }
          ]]
        }
      : {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "1", value: "1" }]]
        },
    valueShapeSummary: definition.propertyKey === "gpio_int"
      ? "phandle-list · 32 bit · 3 cells"
      : "cell-array · 32 bit · 1 cell",
    schemaState: definition.governanceState === "blocked" ? "invalid" : "valid",
    policyState: "pass",
    mappingOpen: definition.governanceState === "attention",
    governanceState: definition.governanceState,
    effects: [],
    searchText: [
      definition.propertyKey,
      definition.driverModule,
      topologyPath,
      definition.rawValue,
      definition.governanceState
    ].join(" ").toLocaleLowerCase(),
    view
  };
}

function renderWorkbench(overrides?: Partial<React.ComponentProps<typeof DtsParameterWorkbench>>) {
  const props: React.ComponentProps<typeof DtsParameterWorkbench> = {
    sourceRows,
    effectiveRows,
    sourceNodes,
    effectiveNodes,
    draftBindingIds: new Set(["binding-gpio-int"]),
    canEdit: true,
    onSelectBinding: vi.fn(),
    onEditBinding: vi.fn(),
    onCreateDraft: vi.fn().mockResolvedValue({ valid: true, diagnostics: [] }),
    ...overrides
  };
  return { ...render(<DtsParameterWorkbench {...props} />), props };
}

function visibleBindingRows(): HTMLElement[] {
  return screen.getAllByRole("row").filter((element) => element.dataset.bindingId);
}

function selectModuleDevice(moduleLabel: RegExp, deviceLabel: RegExp) {
  const moduleNode = screen.getByRole("treeitem", { name: moduleLabel });
  fireEvent.keyDown(moduleNode, { key: "ArrowRight" });
  return screen.getByRole("treeitem", { name: deviceLabel });
}

describe("DtsParameterWorkbench", () => {
  it("exposes scoped mature-workbench regions for topology, list and current edits", () => {
    renderWorkbench({
      currentEdits: <div data-testid="current-edits-slot">当前已修改</div>
    });

    const workbench = screen.getByRole("region", { name: "DTS 参数工作台" });
    expect(workbench).toHaveClass("dts-parameter-workbench");
    expect(workbench.querySelector(".dts-workbench-topology")).toHaveAttribute(
      "aria-label",
      "模块导航"
    );
    expect(workbench.querySelector(".dts-workbench-list")).toHaveAttribute(
      "aria-label",
      "DTS 参数列表"
    );
    expect(workbench.querySelector(".dts-draft-tray")).toHaveAttribute(
      "aria-label",
      "本轮已修改"
    );
    expect(workbench.querySelectorAll("svg").length).toBeGreaterThan(5);
  });

  it("keeps the responsive visual contract scoped to the DTS workbench", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8"
    );

    expect(styles).toMatch(/\.dts-parameter-workbench[^{]*\{/);
    expect(styles).toMatch(/\.dts-workbench-topology[^{]*\{/);
    expect(styles).toMatch(/\.dts-workbench-list[^{]*\{/);
    expect(styles).toMatch(/\.dts-draft-tray[^{]*\{/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*1200px\)/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*820px\)/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*480px\)/);
    expect(styles).toMatch(/\.dts-parameter-workbench[\s\S]*:focus-visible/);
    expect(styles).toMatch(/\.dts-workbench-list[^{]*\{[^}]*height:\s*min\(670px/);
    expect(styles).toMatch(/\.dts-workbench-list__scroll-x[^{]*\{[^}]*overflow-x:\s*auto/);
    expect(styles).toMatch(/\.dts-workbench-list__scroll-y[^{]*\{[^}]*min-width:\s*1100px/);
    expect(styles).toMatch(/\.dts-workbench-list__h-rail[^{]*\{[^}]*overflow-x:\s*scroll/);
    expect(styles).toMatch(/\.dts-workbench-list__h-rail-spacer[^{]*\{[^}]*min-width:\s*1100px/);
    expect(styles).toMatch(/\.dts-parameter-workbench-table[^{]*\{[^}]*min-width:\s*1100px/);
    expect(styles).toMatch(/\.dts-parameter-workbench-table__head[^{]*\{[^}]*position:\s*sticky/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*1200px\)[\s\S]*\.dts-parameter-workbench-table[\s\S]*min-width:\s*920px/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*\.dts-parameter-workbench-table--surface-mvp[\s\S]*min-width:\s*0/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*\.dts-parameter-workbench-table--surface-mvp\s+\.dts-parameter-workbench-table__row[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1\.5fr\)/);

    expect(styles).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*\.dts-parameter-workbench-table[\s\S]*min-width:\s*0/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*\.dts-parameter-workbench-table__head[\s\S]*display:\s*none/);
    expect(styles).toMatch(/min-height:\s*44px/);
    expect(styles).toContain("--dts-workbench-muted: #52657d");
    expect(styles).not.toContain("--dts-workbench-muted: #5e6b7e");
    expect(styles).toMatch(/\.dts-parameter-workbench__governance-content\s+:is\([^}]+\)[\s\S]*min-height:\s*44px/);
    expect(styles).toMatch(/prefers-reduced-motion[\s\S]*\.dts-binding-detail-dialog__overlay[\s\S]*animation:\s*none/);
  });

  it("renders module-first headers and module navigator by default", () => {
    renderWorkbench();

    const workbench = screen.getByRole("region", { name: "DTS 参数工作台" });
    expect(within(workbench).getByRole("searchbox", { name: "搜索 DTS 参数" })).toBeVisible();
    expect(screen.getByRole("tree", { name: "业务模块树" })).toBeInTheDocument();
    const headers = within(workbench).getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers).toEqual([
      expect.stringContaining(""),
      expect.stringContaining("参数名"),
      expect.stringContaining("所属模块"),
      "器件 / 驱动",
      expect.stringContaining("当前值"),
      expect.stringContaining("重要性"),
      "操作"
    ]);
    expect(headers[0]).toContain(""); // checkbox column
    expect(screen.getByRole("status")).toHaveTextContent("显示 4 / 4 个参数");
    expect(visibleBindingRows()).toHaveLength(4);
  });

  it("searches precomputed semantic search text and clears the query back to the full result", () => {
    renderWorkbench();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 DTS 参数" }), {
      target: { value: "gpio13" }
    });

    expect(visibleBindingRows()).toHaveLength(1);
    expect(visibleBindingRows()[0]).toHaveAttribute("data-binding-id", "binding-gpio-int");
    expect(screen.getByRole("status")).toHaveTextContent("显示 1 / 4 个参数");

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 DTS 参数" }), {
      target: { value: "" }
    });
    expect(screen.getByRole("searchbox", { name: "搜索 DTS 参数" })).toHaveValue("");
    expect(visibleBindingRows()).toHaveLength(4);
    expect(screen.getByRole("status")).toHaveTextContent("显示 4 / 4 个参数");
  });

  it("filters by the selected module subtree using binding identity", () => {
    renderWorkbench();

    const moduleNode = screen.getByRole("treeitem", { name: /未分类 · sc8562/ });
    fireEvent.click(moduleNode);

    expect(visibleBindingRows().map((element) => element.dataset.bindingId)).toEqual([
      "binding-gpio-int",
      "binding-watchdog"
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("显示 2 / 4 个参数");
    expect(screen.queryByText("rx_fod_cond")).not.toBeInTheDocument();
  });

  it("keeps module filter scoped to parameters mode and does not filter the DTS source pane", async () => {
    const loadPrimaryDtsSource = vi.fn().mockResolvedValue({
      fileName: "aurora-board.dts",
      versionNumber: 2,
      text: "/ {\n  board_id = \"aurora\";\n};"
    });
    renderWorkbench({ loadPrimaryDtsSource });

    const moduleNode = screen.getByRole("treeitem", { name: /未分类 · sc8562/ });
    fireEvent.click(moduleNode);
    expect(visibleBindingRows()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "技术视图" }));
    await waitFor(() => expect(loadPrimaryDtsSource).toHaveBeenCalled());
    expect(screen.getAllByText(/aurora-board\.dts · v2/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("row", { name: /gpio_int/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tree", { name: "业务模块树" })).toBeInTheDocument();
  });

  it("treats a stale selected module node as unselected when module tree data refreshes", () => {
    const { props, rerender } = renderWorkbench();
    fireEvent.click(screen.getByRole("treeitem", { name: /未分类 · sc8562/ }));
    expect(visibleBindingRows()).toHaveLength(2);

    const refreshedRows = effectiveRows.filter((row) => row.driverModule !== "sc8562");
    rerender(<DtsParameterWorkbench {...props} effectiveRows={refreshedRows} />);
    expect(visibleBindingRows()).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("显示 2 / 2 个参数");

    rerender(<DtsParameterWorkbench {...props} />);
    expect(visibleBindingRows()).toHaveLength(4);
  });

  it("renders importance as the primary column and only surfaces anomaly governance badges", () => {
    renderWorkbench();

    expect(screen.getByRole("button", { name: "按重要性排序" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("重要性：中")).toHaveLength(4);
    expect(screen.queryByLabelText("治理状态：valid")).not.toBeInTheDocument();
    expect(screen.getByLabelText("治理状态：attention")).toBeInTheDocument();
    expect(screen.getByLabelText("治理状态：blocked")).toBeInTheDocument();
    expect(screen.getByTestId("draft-binding-gpio-int")).toHaveTextContent("草稿");
    expect(screen.queryByRole("combobox", { name: "治理状态" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "重要性" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "清除全部筛选" })).not.toBeInTheDocument();
  });

  it("keeps module navigator and shows DTS source in tech view", async () => {
    const loadPrimaryDtsSource = vi.fn().mockResolvedValue({
      fileName: "aurora-board.dts",
      versionNumber: 2,
      text: "/ {\n  board_id = \"aurora\";\n};"
    });
    renderWorkbench({ loadPrimaryDtsSource });

    expect(screen.getByRole("tree", { name: "业务模块树" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "技术视图" }));

    await waitFor(() => expect(loadPrimaryDtsSource).toHaveBeenCalled());
    expect(screen.getByRole("tree", { name: "业务模块树" })).toBeInTheDocument();
    expect(screen.queryByRole("tree", { name: "生效 DTS 拓扑" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/aurora-board\.dts · v2/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("DTS 源码")).toBeInTheDocument();
  });

  it("always exposes details while canEdit only controls the edit entry", () => {
    const onSelectBinding = vi.fn();
    const onEditBinding = vi.fn();
    renderWorkbench({ canEdit: false, onSelectBinding, onEditBinding });

    fireEvent.click(screen.getByRole("button", {
      name: "查看 gpio_int（未分类 · sc8562 · sc8562@6E · sc8562）"
    }));
    expect(onSelectBinding).toHaveBeenCalledWith("binding-gpio-int");
    expect(screen.queryByRole("button", { name: /编辑 gpio_int/ })).not.toBeInTheDocument();
    expect(document.querySelector('[data-binding-id="binding-gpio-int"]')).toHaveAttribute("aria-selected", "true");
  });

  it("opens the selected semantic binding in the read-only detail dialog", () => {
    renderWorkbench({ canEdit: false });

    fireEvent.click(screen.getByRole("button", {
      name: "查看 gpio_int（未分类 · sc8562 · sc8562@6E · sc8562）"
    }));

    const dialog = screen.getByRole("dialog", { name: "gpio_int 参数详情" });
    expect(within(dialog).getByRole("heading", { name: "参数定义" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "类型化编辑" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("来源链")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("技术身份")).not.toBeInTheDocument();
  });

  it("loads and renders cross-project compare peers when the detail dialog opens", async () => {
    const loadBindingCompare = vi.fn().mockResolvedValue([
      {
        projectId: "project-aurora",
        projectName: "Aurora",
        rawValue: "<1>",
        moduleName: "充电策略",
        driverModule: "sc8562"
      }
    ]);
    renderWorkbench({ canEdit: false, loadBindingCompare, projectId: "project-source" });

    fireEvent.click(screen.getByRole("button", {
      name: "查看 gpio_int（未分类 · sc8562 · sc8562@6E · sc8562）"
    }));

    await waitFor(() => expect(loadBindingCompare).toHaveBeenCalledWith("binding-gpio-int"));
    const dialog = screen.getByRole("dialog", { name: "gpio_int 参数详情" });
    const entry = within(dialog).getByRole("heading", { name: "跨项目对比" }).closest("section") as HTMLElement;
    expect(within(entry).getByRole("button", { name: "打开跨项目对比" })).toBeInTheDocument();
    expect(within(entry).getByText(/个项目已配置/)).toBeInTheDocument();
  });

  it("seeds the local draft bag from a compare peer target value", async () => {
    const user = userEvent.setup();
    const loadBindingCompare = vi.fn().mockResolvedValue([
      {
        projectId: "project-aurora",
        projectName: "Aurora",
        rawValue: "<99>",
        moduleName: "充电策略"
      }
    ]);
    renderWorkbench({ loadBindingCompare, projectId: "project-source" });

    await user.click(screen.getByRole("button", {
      name: "查看 gpio_int（未分类 · sc8562 · sc8562@6E · sc8562）"
    }));
    await waitFor(() => expect(loadBindingCompare).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "打开跨项目对比" }));
    await user.click(screen.getByRole("button", { name: "使用该项目配置加入草稿" }));

    const draftDialog = screen.getByRole("dialog", { name: "修改草稿" });
    expect(within(draftDialog).getByRole("textbox", { name: "目标值" })).toHaveValue("<99>");
    expect(within(draftDialog).getByRole("textbox", { name: "修改原因" })).toHaveValue(
      "参考 Aurora 当前配置生成草稿"
    );
  });

  it("opens edit in the draft dialog and focuses the target editor", async () => {
    const user = userEvent.setup();
    const { props } = renderWorkbench();

    await user.click(screen.getByRole("button", {
      name: "继续编辑 gpio_int（未分类 · sc8562 · sc8562@6E · sc8562）"
    }));

    expect(screen.queryByRole("dialog", { name: "gpio_int 参数详情" })).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "修改草稿" });
    expect(within(dialog).getByRole("textbox", { name: "目标值" })).toHaveFocus();
    expect(props.onEditBinding).toHaveBeenCalledWith("binding-gpio-int");
  });

  it("closes only the selected binding and restores the opener without clearing filters or draft identity", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 DTS 参数" }), {
      target: { value: "gpio13" }
    });
    const opener = screen.getByRole("button", {
      name: "查看 gpio_int（未分类 · sc8562 · sc8562@6E · sc8562）"
    });

    await user.click(opener);
    await user.click(within(screen.getByRole("dialog", { name: "gpio_int 参数详情" }))
      .getByRole("button", { name: "关闭参数详情" }));

    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "gpio_int 参数详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索 DTS 参数" })).toHaveValue("gpio13");
    expect(screen.getByTestId("draft-binding-gpio-int")).toHaveTextContent("草稿");
    expect(visibleBindingRows()).toHaveLength(1);
  });

  it("does not render an inert edit action when its handler is absent", () => {
    renderWorkbench({ canEdit: true, onEditBinding: undefined });

    expect(screen.getByRole("button", { name: /查看 gpio_int/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编辑 gpio_int/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /继续编辑 gpio_int/ })).not.toBeInTheDocument();
  });

  it("disambiguates repeated property actions and names draft actions as continue editing", () => {
    const secondNode = effectiveNode(
      "effective-sc8562-secondary",
      "logical-sc8562-secondary",
      "logical-i2c",
      "sc8562",
      "6F",
      "sc8562"
    );
    const secondGpioRow: DtsParameterWorkbenchRow = {
      ...effectiveRows[0],
      bindingId: "binding-gpio-int-secondary",
      parameterSpecId: "spec-gpio-int-secondary",
      parameterSpecVersionId: "spec-version-gpio-int-secondary",
      logicalNodeId: "logical-sc8562-secondary",
      instanceName: "sc8562@6F",
      topologyNodeId: secondNode.id,
      topologyPath: "/amba/i2c@FDF5E000/sc8562@6F",
      rawValue: "<&gpio14 30 0>"
    };
    renderWorkbench({
      effectiveRows: [...effectiveRows, secondGpioRow],
      effectiveNodes: [...effectiveNodes, secondNode]
    });

    expect(screen.getByRole("button", {
      name: "查看 gpio_int（未分类 · sc8562 · sc8562@6E · sc8562）"
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "查看 gpio_int（未分类 · sc8562 · sc8562@6F · sc8562）"
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "继续编辑 gpio_int（未分类 · sc8562 · sc8562@6E · sc8562）"
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "编辑 gpio_int（未分类 · sc8562 · sc8562@6F · sc8562）"
    })).toBeInTheDocument();
  });

  it("uses neutral row/card and navigator containers without accessibility violations", async () => {
    const { container } = renderWorkbench();
    const workbench = screen.getByRole("region", { name: "DTS 参数工作台" });

    expect(within(workbench).queryByRole("complementary")).not.toBeInTheDocument();
    expect(visibleBindingRows().every((rowElement) => rowElement.tagName === "DIV")).toBe(true);
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } }
    });
    expect(results.violations).toEqual([]);
  });

  it("uses the binding id as row identity and never renders legacy recommendation vocabulary", () => {
    renderWorkbench();

    for (const element of visibleBindingRows()) {
      expect(element.dataset.bindingId).toMatch(/^binding-/);
    }
    expect(screen.queryByText(/推荐值|recommendedValue/i)).not.toBeInTheDocument();
  });

  it("focuses the smallest positive sourceLine when a module is selected in tech view", async () => {
    const rowsWithLines = effectiveRows.map((entry) => {
      if (entry.bindingId === "binding-gpio-int") return { ...entry, sourceLine: 12 };
      if (entry.bindingId === "binding-watchdog") return { ...entry, sourceLine: 8 };
      return entry;
    });
    const loadPrimaryDtsSource = vi.fn().mockResolvedValue({
      fileName: "aurora-board.dts",
      versionNumber: 2,
      text: Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join("\n")
    });
    const { container } = renderWorkbench({ effectiveRows: rowsWithLines, loadPrimaryDtsSource });

    fireEvent.click(screen.getByRole("button", { name: "技术视图" }));
    await waitFor(() => expect(loadPrimaryDtsSource).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getAllByText(/aurora-board\.dts · v2/).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("treeitem", { name: /未分类 · sc8562/ }));
    expect(container.querySelector('[data-line="8"]')).toHaveClass("is-focused");
  });

  it("shows module jump status when the selected module has no sourceLine", async () => {
    const rowsWithoutLines = effectiveRows.map((entry) => ({ ...entry, sourceLine: null }));
    const loadPrimaryDtsSource = vi.fn().mockResolvedValue({
      fileName: "aurora-board.dts",
      versionNumber: 1,
      text: "/ { };"
    });
    renderWorkbench({ effectiveRows: rowsWithoutLines, loadPrimaryDtsSource });

    fireEvent.click(screen.getByRole("button", { name: "技术视图" }));
    await waitFor(() => expect(loadPrimaryDtsSource).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("treeitem", { name: /未分类 · sc8562/ }));

    expect(screen.getByRole("status")).toHaveTextContent("当前模块暂无源码行定位");
  });

  it("shows DTS file meta near the download control in tech view", async () => {
    const loadPrimaryDtsSource = vi.fn().mockResolvedValue({
      fileName: "aurora-board.dts",
      versionNumber: 2,
      text: "/ { };"
    });
    renderWorkbench({ loadPrimaryDtsSource });

    fireEvent.click(screen.getByRole("button", { name: "技术视图" }));
    await waitFor(() => expect(loadPrimaryDtsSource).toHaveBeenCalled());

    const downloadButton = await screen.findByRole("button", { name: "下载 DTS" });
    expect(downloadButton).not.toBeDisabled();
    const headerActions = downloadButton.closest(".dts-parameter-workbench__header-actions") as HTMLElement;
    expect(within(headerActions).getByText("aurora-board.dts · v2")).toBeInTheDocument();
  });

  it("surfaces the loadPrimaryDtsSource rejection message in tech view", async () => {
    const loadPrimaryDtsSource = vi.fn().mockRejectedValue(
      new Error("未找到可用的项目主 DTS 文件")
    );
    renderWorkbench({ loadPrimaryDtsSource });

    fireEvent.click(screen.getByRole("button", { name: "技术视图" }));
    await waitFor(() => expect(loadPrimaryDtsSource).toHaveBeenCalled());

    expect(screen.getByRole("alert")).toHaveTextContent("无法加载 DTS 源码。");
    expect(screen.getByText("未找到可用的项目主 DTS 文件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("uses DTS find semantics for the search control in tech view", async () => {
    const loadPrimaryDtsSource = vi.fn().mockResolvedValue({
      fileName: "aurora-board.dts",
      versionNumber: 1,
      text: "alpha\nbeta-gamma\nomega"
    });
    renderWorkbench({ loadPrimaryDtsSource });

    fireEvent.click(screen.getByRole("button", { name: "技术视图" }));
    await waitFor(() => expect(loadPrimaryDtsSource).toHaveBeenCalled());

    const searchbox = await screen.findByRole("searchbox", { name: "在 DTS 源码中查找" });
    expect(searchbox).toHaveAttribute("placeholder", "在 DTS 文本中查找");
    fireEvent.change(searchbox, { target: { value: "gamma" } });
    expect(screen.getByRole("status")).toHaveTextContent(/匹配/);
  });
});
