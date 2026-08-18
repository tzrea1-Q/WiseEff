import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import {
  SpecCreateDialog,
  subjectPickerFlatNodes,
  subjectsFromModules,
} from "./SpecCreateDialog";

afterEach(() => {
  cleanup();
});

const sampleModules: ParameterModule[] = [
  {
    id: "m-business",
    name: "业务",
    parentId: null,
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "medium",
    kind: "business",
    origin: "curated",
    sourceKey: null,
    effectiveImportance: "medium",
    parameterCount: 0,
    definitionCount: 0,
    attributionSubjectId: null,
  },
  {
    id: "m-driver",
    name: "SC8562",
    parentId: "m-business",
    sortOrder: 1,
    description: "",
    scope: "",
    importance: "medium",
    kind: "driver-group",
    origin: "curated",
    sourceKey: "compatible:vendor,sc8562",
    effectiveImportance: "medium",
    parameterCount: 2,
    definitionCount: 2,
    attributionSubjectId: "asub:driver:sc8562",
  },
  {
    id: "m-node",
    name: "charger",
    parentId: "m-driver",
    sortOrder: 2,
    description: "",
    scope: "",
    importance: "medium",
    kind: "node-type",
    origin: "curated",
    sourceKey: "nodetype:charger",
    effectiveImportance: "medium",
    parameterCount: 1,
    definitionCount: 1,
    attributionSubjectId: "asub:nodetype:charger",
  },
];

describe("subjectsFromModules", () => {
  it("keeps only driver-group and node-type modules with attribution subjects", () => {
    expect(subjectsFromModules(sampleModules)).toEqual([
      {
        moduleId: "m-driver",
        attributionSubjectId: "asub:driver:sc8562",
        label: "SC8562 (驱动登记)",
        kind: "driver-group",
        compatibleHint: "vendor,sc8562",
      },
      {
        moduleId: "m-node",
        attributionSubjectId: "asub:nodetype:charger",
        label: "charger (节点类型)",
        kind: "node-type",
        compatibleHint: null,
      },
    ]);
  });
});

describe("subjectPickerFlatNodes", () => {
  it("keeps ancestors so the subject picker can render a connected tree", () => {
    expect(subjectPickerFlatNodes(sampleModules).map((node) => node.id)).toEqual([
      "m-business",
      "m-driver",
      "m-node",
    ]);
    expect(subjectPickerFlatNodes(sampleModules).find((node) => node.id === "m-driver")?.name).toBe(
      "SC8562（驱动组）",
    );
  });
});

describe("SpecCreateDialog", () => {
  it("picks attribution subjects from ModuleTreeSelect and submits a full draft payload", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <SpecCreateDialog
        modules={sampleModules}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("button", { name: "归属主体" })).toHaveTextContent("业务 / SC8562（驱动组）");
    fireEvent.click(screen.getByRole("button", { name: "归属主体" }));
    const tree = screen.getByRole("tree");
    expect(within(tree).getByText("业务")).toBeInTheDocument();
    fireEvent.click(within(tree).getByRole("button", { name: "charger（节点类型）" }));
    expect(screen.getByRole("button", { name: "归属主体" })).toHaveTextContent(
      "业务 / SC8562（驱动组） / charger（节点类型）",
    );

    expect(screen.getByLabelText("展示名")).toBeInTheDocument();
    expect(screen.getByLabelText("值形状 valueShape")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toHaveClass("button", "primary");

    await user.clear(screen.getByLabelText("属性键"));
    await user.type(screen.getByLabelText("属性键"), "gpio_int");
    await user.type(screen.getByLabelText("展示名"), "GPIO 中断");
    await user.type(screen.getByLabelText("文档说明"), "中断脚定义");
    await user.selectOptions(screen.getByLabelText("值形状 valueShape"), "phandle-list");
    fireEvent.change(screen.getByLabelText("每组数值个数"), { target: { value: "3" } });
    await user.type(screen.getByLabelText("单位"), "n/a");
    await user.type(screen.getByLabelText("示例值（JSON 或原文，可空）"), '"<&gpio 1 0>"');
    await user.click(screen.getByLabelText(/overridePlatform/));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认新建" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("变更原因"), "library create");
    await user.click(screen.getByRole("button", { name: "确认创建" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        attributionSubjectId: "asub:nodetype:charger",
        propertyKey: "gpio_int",
        displayName: "GPIO 中断",
        documentation: "中断脚定义",
        reason: "library create",
        units: "n/a",
        overridePlatform: true,
        valueShape: {
          kind: "phandle-list",
          bits: 32,
          cellsPerGroup: 3,
        },
        constraints: { cells: 3 },
        exampleValue: "<&gpio 1 0>",
      }),
    );
  });

  it("keeps save disabled while subjects are loading", () => {
    render(
      <SpecCreateDialog
        modules={[]}
        subjectsLoading
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("正在加载归属主体…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  });

  it("renders the server error inside the confirm layer instead of suppressing it", async () => {
    const user = userEvent.setup();
    render(
      <SpecCreateDialog
        modules={sampleModules}
        error="创建冲突：同名定义已存在"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await user.clear(screen.getByLabelText("属性键"));
    await user.type(screen.getByLabelText("属性键"), "gpio_int");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    const confirmLayer = screen.getByRole("dialog", { name: "确认新建" });
    expect(within(confirmLayer).getByRole("alert")).toHaveTextContent("创建冲突：同名定义已存在");
  });
});
