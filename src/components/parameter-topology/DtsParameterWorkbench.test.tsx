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

function expandToSc8562(label: RegExp) {
  const root = screen.getByRole("treeitem", { name: /^\// });
  fireEvent.keyDown(root, { key: "ArrowRight" });
  const amba = screen.getByRole("treeitem", { name: /amba/ });
  fireEvent.keyDown(amba, { key: "ArrowRight" });
  const i2c = screen.getByRole("treeitem", { name: /i2c@FDF5E000/ });
  fireEvent.keyDown(i2c, { key: "ArrowRight" });
  return screen.getByRole("treeitem", { name: label });
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
      "DTS 拓扑导航"
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
    expect(styles).toMatch(/@media\s*\(max-width:\s*1200px\)[\s\S]*\.dts-workbench-list[\s\S]*overflow-x:\s*auto/);
    expect(styles).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(styles).toMatch(/min-height:\s*44px/);
    expect(styles).toContain("--dts-workbench-muted: #52657d");
    expect(styles).not.toContain("--dts-workbench-muted: #5e6b7e");
  });

  it("renders the semantic workbench contract and exact mature table headers", () => {
    renderWorkbench();

    const workbench = screen.getByRole("region", { name: "DTS 参数工作台" });
    expect(within(workbench).getByRole("searchbox", { name: "搜索 DTS 参数" })).toBeVisible();
    expect(within(workbench).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "属性",
      "器件 / 驱动",
      "DTS 位置",
      "生效值",
      "类型",
      "治理",
      "操作"
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("显示 4 / 4 个参数");
    expect(visibleBindingRows()).toHaveLength(4);
    expect(visibleBindingRows()[0]).toHaveAttribute("data-binding-id", "binding-gpio-int");
  });

  it("searches precomputed semantic search text and clears all filters back to the full result", () => {
    renderWorkbench();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 DTS 参数" }), {
      target: { value: "gpio13" }
    });

    expect(visibleBindingRows()).toHaveLength(1);
    expect(visibleBindingRows()[0]).toHaveAttribute("data-binding-id", "binding-gpio-int");
    expect(screen.getByRole("status")).toHaveTextContent("显示 1 / 4 个参数");

    fireEvent.click(screen.getByRole("button", { name: "清除全部筛选" }));
    expect(screen.getByRole("searchbox", { name: "搜索 DTS 参数" })).toHaveValue("");
    expect(visibleBindingRows()).toHaveLength(4);
    expect(screen.getByRole("status")).toHaveTextContent("显示 4 / 4 个参数");
  });

  it("filters by the selected topology subtree using binding identity rather than path prefixes", () => {
    renderWorkbench();

    const sc8562 = expandToSc8562(/sc8562@6E/);
    fireEvent.click(sc8562);

    expect(visibleBindingRows().map((element) => element.dataset.bindingId)).toEqual([
      "binding-gpio-int",
      "binding-watchdog",
      "binding-sensor-limit"
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("显示 3 / 4 个参数");
    expect(screen.queryByText("rx_fod_cond")).not.toBeInTheDocument();
  });

  it("treats a stale selected node as unselected when same-view topology data refreshes", () => {
    const { props, rerender } = renderWorkbench();
    fireEvent.click(expandToSc8562(/sc8562@6E/));
    expect(visibleBindingRows()).toHaveLength(3);

    const refreshedEffectiveNodes = effectiveNodes.filter(
      (node) => node.id !== "effective-sc8562" && node.id !== "effective-sensor"
    );
    rerender(
      <DtsParameterWorkbench {...props} effectiveNodes={refreshedEffectiveNodes} />
    );
    expect(visibleBindingRows()).toHaveLength(4);
    expect(screen.getByRole("status")).toHaveTextContent("显示 4 / 4 个参数");

    rerender(<DtsParameterWorkbench {...props} />);
    expect(visibleBindingRows()).toHaveLength(4);
  });

  it("filters all governance states, renders their badges and preserves external draft identity on clear", () => {
    renderWorkbench();

    expect(screen.getAllByLabelText("治理状态：valid")).toHaveLength(2);
    expect(screen.getByLabelText("治理状态：attention")).toBeInTheDocument();
    expect(screen.getByLabelText("治理状态：blocked")).toBeInTheDocument();
    expect(screen.getByTestId("draft-binding-gpio-int")).toHaveTextContent("草稿");

    fireEvent.change(screen.getByRole("combobox", { name: "治理状态" }), {
      target: { value: "blocked" }
    });
    expect(visibleBindingRows()).toHaveLength(1);
    expect(visibleBindingRows()[0]).toHaveAttribute("data-binding-id", "binding-sensor-limit");

    fireEvent.click(screen.getByRole("button", { name: "清除全部筛选" }));
    expect(screen.getByRole("combobox", { name: "治理状态" })).toHaveValue("all");
    expect(screen.getByTestId("draft-binding-gpio-int")).toHaveTextContent("草稿");
  });

  it("switches source and effective topology using each view's node identity and labels", () => {
    renderWorkbench();

    const effectiveSc8562 = expandToSc8562(/sc8562@6E/);
    fireEvent.click(effectiveSc8562);
    expect(visibleBindingRows()).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "源 DTS" }));
    expect(screen.getByRole("tree", { name: "源 DTS 拓扑" })).toBeInTheDocument();
    expect(visibleBindingRows()).toHaveLength(4);
    const sourceSc8562 = expandToSc8562(/sc8562-source@6E/);
    fireEvent.click(sourceSc8562);

    expect(visibleBindingRows()).toHaveLength(3);
    expect(visibleBindingRows()[0]).toHaveTextContent("/amba/i2c@FDF5E000/sc8562-source@6E");
    expect(sourceSc8562).toHaveAttribute("aria-selected", "true");
  });

  it("always exposes details while canEdit only controls the edit entry", () => {
    const onSelectBinding = vi.fn();
    const onEditBinding = vi.fn();
    renderWorkbench({ canEdit: false, onSelectBinding, onEditBinding });

    fireEvent.click(screen.getByRole("button", {
      name: "查看 gpio_int（sc8562@6E · sc8562 · /amba/i2c@FDF5E000/sc8562@6E）"
    }));
    expect(onSelectBinding).toHaveBeenCalledWith("binding-gpio-int");
    expect(screen.queryByRole("button", { name: /编辑 gpio_int/ })).not.toBeInTheDocument();
    expect(document.querySelector('[data-binding-id="binding-gpio-int"]')).toHaveAttribute("aria-selected", "true");
  });

  it("opens the selected semantic binding in the mature detail dialog", () => {
    renderWorkbench({ canEdit: false });

    fireEvent.click(screen.getByRole("button", {
      name: "查看 gpio_int（sc8562@6E · sc8562 · /amba/i2c@FDF5E000/sc8562@6E）"
    }));

    const dialog = screen.getByRole("dialog", { name: "gpio_int 参数详情" });
    expect(within(dialog).getByRole("heading", { name: "身份" })).toBeInTheDocument();
    expect(within(dialog).getByText("binding-gpio-int")).toBeInTheDocument();
    expect(within(dialog).getByText("logical-sc8562")).toBeInTheDocument();
    expect(within(dialog).getByText("当前接口未提供规格详情")).toBeInTheDocument();
  });

  it("opens view and edit actions in the same detail flow and focuses typed editing on edit", async () => {
    const user = userEvent.setup();
    const { props } = renderWorkbench();

    await user.click(screen.getByRole("button", {
      name: "继续编辑 gpio_int（sc8562@6E · sc8562 · /amba/i2c@FDF5E000/sc8562@6E）"
    }));

    const dialog = screen.getByRole("dialog", { name: "gpio_int 参数详情" });
    expect(within(dialog).getByRole("textbox", { name: "目标值 raw" })).toHaveFocus();
    expect(props.onSelectBinding).toHaveBeenCalledWith("binding-gpio-int");
    expect(props.onEditBinding).toHaveBeenCalledWith("binding-gpio-int");
  });

  it("closes only the selected binding and restores the opener without clearing filters or draft identity", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 DTS 参数" }), {
      target: { value: "gpio13" }
    });
    const opener = screen.getByRole("button", {
      name: "查看 gpio_int（sc8562@6E · sc8562 · /amba/i2c@FDF5E000/sc8562@6E）"
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
      name: "查看 gpio_int（sc8562@6E · sc8562 · /amba/i2c@FDF5E000/sc8562@6E）"
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "查看 gpio_int（sc8562@6F · sc8562 · /amba/i2c@FDF5E000/sc8562@6F）"
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "继续编辑 gpio_int（sc8562@6E · sc8562 · /amba/i2c@FDF5E000/sc8562@6E）"
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "编辑 gpio_int（sc8562@6F · sc8562 · /amba/i2c@FDF5E000/sc8562@6F）"
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
});
