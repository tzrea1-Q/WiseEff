import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EffectiveTopologyNode,
  IdentityMappingTask,
  ProjectParameterBinding,
  SourceTopologyNode,
  TopologyDiagnostic
} from "@/domain/parameter-topology/types";
import {
  ProjectTopologyWorkspace,
  TOPOLOGY_TEACHING_BINDINGS,
  TOPOLOGY_TEACHING_EFFECTIVE_NODES,
  TOPOLOGY_TEACHING_SOURCE_NODES
} from "./ProjectTopologyWorkspace";

afterEach(() => {
  cleanup();
});

const OPEN_MAPPING: IdentityMappingTask = {
  id: "map-task-1",
  projectId: "aurora",
  configRevisionId: "rev-1",
  previousLogicalNodeId: "logical-old",
  candidateLogicalNodeIds: ["logical-sc8562"],
  status: "open",
  reason: "overlay target ambiguous",
  createdAt: "2026-07-16T00:00:00.000Z"
};

const COMPILE_DIAGNOSTICS: TopologyDiagnostic[] = [
  {
    severity: "error",
    code: "DTC_COMPILE_FAILED",
    message: "Undefined node reference: gpio99",
    path: "/amba/i2c@FDF5E000/sc8562@6E",
    guidance: "Fix the phandle or add the missing label."
  }
];

function renderWorkspace(
  overrides: Partial<ComponentProps<typeof ProjectTopologyWorkspace>> = {}
) {
  return render(
    <ProjectTopologyWorkspace
      projectId="aurora"
      configSetId="cs-1"
      revisionId="rev-1"
      sourceNodes={TOPOLOGY_TEACHING_SOURCE_NODES}
      effectiveNodes={TOPOLOGY_TEACHING_EFFECTIVE_NODES}
      bindings={TOPOLOGY_TEACHING_BINDINGS}
      canEdit
      {...overrides}
    />
  );
}

describe("ProjectTopologyWorkspace", () => {
  it("renders tree hierarchy, gpio_int cell, and effective value without path-as-identity", () => {
    renderWorkspace();

    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    expect(within(workspace).getByRole("treeitem", { name: /amba/ })).toBeVisible();
    expect(within(workspace).getByRole("treeitem", { name: /i2c@FDF5E000/ })).toBeVisible();
    expect(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ })).toBeVisible();

    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));

    expect(within(workspace).getByRole("cell", { name: "gpio_int" })).toBeVisible();
    expect(within(workspace).getByText("<&gpio13 29 0>")).toBeVisible();
    expect(workspace.textContent).not.toMatch(/sourceNodePath/);
  });

  it("toggles source and effective modes with occurrence vs provenance", () => {
    renderWorkspace();
    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });

    fireEvent.click(within(workspace).getByRole("radio", { name: "源树" }));
    expect(within(workspace).getByText(/power\.dtsi · L42/)).toBeVisible();

    const ambaItems = within(workspace).getAllByRole("treeitem", { name: /&amba|amba/ });
    expect(ambaItems.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));
    const sourceDetail = within(workspace).getByRole("region", { name: "绑定详情" });
    expect(within(sourceDetail).getByRole("region", { name: "源 occurrence" })).toBeVisible();
    expect(within(sourceDetail).getByText(/覆盖写入|set/i)).toBeVisible();

    fireEvent.click(within(workspace).getByRole("radio", { name: "生效树" }));
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));

    const effectiveDetail = within(workspace).getByRole("region", { name: "绑定详情" });
    expect(within(effectiveDetail).getByText(/来源链|provenance/i)).toBeVisible();
    expect(within(effectiveDetail).getByText(/power\.dtso/)).toBeVisible();
  });

  it("marks unresolved phandle targets in source mode", () => {
    renderWorkspace();
    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });

    fireEvent.click(within(workspace).getByRole("radio", { name: "源树" }));
    expect(within(workspace).getByRole("treeitem", { name: /未解析|unresolved/i })).toBeVisible();
  });

  it("search returns two distinct gpio_int bindings by stable id", () => {
    renderWorkspace();
    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });

    fireEvent.change(within(workspace).getByRole("searchbox", { name: "搜索绑定" }), {
      target: { value: "gpio_int" }
    });

    const cells = within(workspace).getAllByRole("cell", { name: "gpio_int" });
    expect(cells).toHaveLength(2);
    expect(within(workspace).getByText("sc8562")).toBeVisible();
    expect(within(workspace).getByText("mt5788")).toBeVisible();

    fireEvent.click(cells[0]!);
    const detail = within(workspace).getByRole("region", { name: "绑定详情" });
    expect(detail).toHaveAttribute("data-binding-id", "binding-sc8562-gpio-int");
  });

  it("shows typed edit diagnostics and does not publish while blocked", () => {
    const onPublish = vi.fn();
    const onValidateEdit = vi.fn().mockReturnValue({
      valid: false,
      diagnostics: [{ message: "cell count must be 3", code: "SCHEMA_CELL_COUNT" }]
    });

    renderWorkspace({
      canPublish: true,
      onPublish,
      onValidateEdit,
      mappingTasks: [],
      diagnostics: []
    });

    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));

    const detail = within(workspace).getByRole("region", { name: "绑定详情" });
    const valueInput = within(detail).getByLabelText(/目标值|原始值|raw/i);
    fireEvent.change(valueInput, { target: { value: "<&gpio13 29>" } });
    fireEvent.click(within(detail).getByRole("button", { name: /校验|应用诊断/i }));

    expect(within(detail).getByText(/cell count must be 3/)).toBeVisible();
    expect(within(workspace).getByRole("button", { name: /发布/ })).toBeDisabled();
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("blocks publish on open mapping review and compile diagnostics", () => {
    const onPublish = vi.fn();
    renderWorkspace({
      canPublish: true,
      onPublish,
      mappingTasks: [OPEN_MAPPING],
      diagnostics: COMPILE_DIAGNOSTICS
    });

    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    expect(within(workspace).getByRole("region", { name: "映射审核" })).toBeVisible();
    expect(within(workspace).getByText(/Undefined node reference: gpio99/)).toBeVisible();
    expect(within(workspace).getByRole("button", { name: /发布/ })).toBeDisabled();
    expect(within(workspace).getByText(/发布已阻断|无法发布/)).toBeVisible();
  });

  it("shows blocking incomplete state when base is missing", () => {
    renderWorkspace({ incompleteBase: true });

    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    expect(within(workspace).getByRole("alert")).toHaveTextContent(/缺少 base|不完整|incomplete/i);
    expect(within(workspace).queryByRole("tree")).not.toBeInTheDocument();
  });

  it("collapses detail into a drawer at tablet width", () => {
    renderWorkspace({ layoutMode: "tablet" });

    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));

    expect(within(workspace).getByRole("dialog", { name: "绑定详情" })).toBeVisible();
  });

  it("uses tree → properties → detail navigation with breadcrumb on mobile", () => {
    renderWorkspace({ layoutMode: "mobile" });

    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    expect(within(workspace).getByRole("navigation", { name: "拓扑导航" })).toBeVisible();

    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    expect(within(workspace).getByRole("cell", { name: "gpio_int" })).toBeVisible();
    expect(within(workspace).queryByRole("region", { name: "绑定详情" })).not.toBeInTheDocument();

    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));
    expect(within(workspace).getByRole("region", { name: "绑定详情" })).toBeVisible();
    expect(within(workspace).getByRole("navigation", { name: "拓扑导航" })).toHaveTextContent(/树|属性|详情/);
  });
});

describe("topology teaching fixtures", () => {
  it("keeps binding identity separate from locator paths", () => {
    expect(TOPOLOGY_TEACHING_BINDINGS.map((b: ProjectParameterBinding) => b.id)).toEqual([
      "binding-sc8562-gpio-int",
      "binding-mt5788-gpio-int",
      "binding-sc8562-status"
    ]);
    expect(TOPOLOGY_TEACHING_SOURCE_NODES.some((n: SourceTopologyNode) => n.labels.includes("amba"))).toBe(
      true
    );
    expect(
      TOPOLOGY_TEACHING_EFFECTIVE_NODES.some((n: EffectiveTopologyNode) => n.locator.includes("sc8562@6E"))
    ).toBe(true);
  });
});
