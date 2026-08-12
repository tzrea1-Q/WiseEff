import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ParameterModule, ParameterModuleMapping } from "@/domain/parameter-topology/moduleRegistry";
import { ModuleAttributionTree } from "./ModuleAttributionTree";

afterEach(() => cleanup());

const modules: ParameterModule[] = [
  {
    id: "mod-power",
    name: "Power",
    parentId: null,
    sortOrder: 0,
    description: "电源业务",
    scope: "组织",
    importance: "high",
    kind: "business",
    origin: "curated",
    sourceKey: null,
    effectiveImportance: "high",
    parameterCount: 0
  },
  {
    id: "mod-group",
    name: "SC8562",
    parentId: "mod-power",
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "medium",
    kind: "driver-group",
    origin: "auto",
    sourceKey: "compatible:vendor,sc8562",
    effectiveImportance: "high",
    parameterCount: 4
  },
  {
    id: "mod-node-type",
    name: "sc8562",
    parentId: "mod-group",
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "medium",
    kind: "node-type",
    origin: "auto",
    sourceKey: "nodetype:sc8562",
    effectiveImportance: "high",
    parameterCount: 4
  }
];

const mappings: ParameterModuleMapping[] = [
  {
    id: "map-1",
    moduleId: "mod-group",
    matchKind: "compatible",
    matchValue: "vendor,sc8562",
    priority: 100
  }
];

describe("ModuleAttributionTree", () => {
  it("scopes actions by kind and shows compatible rule summary on the driver-group row", () => {
    const onDelete = vi.fn();
    const onRemoveMapping = vi.fn();

    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={onDelete}
        onRemoveMapping={onRemoveMapping}
        onCreateModule={vi.fn()}
      />
    );

    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).getByText("业务分类")).toBeInTheDocument();
    expect(within(tree).getByText("驱动组")).toBeInTheDocument();
    expect(within(tree).getByText("· 1 条 compatible")).toBeInTheDocument();
    expect(within(tree).queryByText("compatible:vendor,sc8562")).not.toBeInTheDocument();
    expect(
      within(tree).queryByRole("button", { name: "删除归属 compatible:vendor,sc8562" })
    ).not.toBeInTheDocument();

    expect(within(tree).getByRole("button", { name: "SC8562 更多操作" })).toBeInTheDocument();
    expect(within(tree).queryByRole("button", { name: /删除模块 sc8562/ })).not.toBeInTheDocument();

    fireEvent.click(within(tree).getByRole("button", { name: "展开 SC8562 子模块" }));
    expect(within(tree).getByText("节点类型")).toBeInTheDocument();
    expect(within(tree).getByRole("button", { name: "修改模块 sc8562" })).toBeInTheDocument();
    expect(within(tree).getByRole("button", { name: "sc8562 更多操作" })).toBeInTheDocument();

    fireEvent.click(within(tree).getByRole("button", { name: "SC8562 更多操作" }));
    expect(screen.getByRole("menuitem", { name: "解散驱动组 SC8562" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "移动模块 SC8562" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /添加子模块到 SC8562/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "移动模块 SC8562" }));
    const moveDialog = screen.getByRole("dialog", { name: "移动模块 SC8562" });
    expect(moveDialog).toBeInTheDocument();
    expect(within(moveDialog).getByText(/移动「SC8562」/)).toBeInTheDocument();
    fireEvent.click(within(moveDialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "移动模块 SC8562" })).not.toBeInTheDocument();

    fireEvent.click(within(tree).getByRole("button", { name: "修改模块 SC8562" }));
    const editDialog = screen.getByRole("dialog", { name: "修改模块 SC8562" });
    expect(within(editDialog).getByText("compatible 匹配规则")).toBeInTheDocument();
    expect(within(editDialog).getByText("compatible:vendor,sc8562")).toBeInTheDocument();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(
      within(editDialog).getByRole("button", { name: "移除规则 compatible:vendor,sc8562" })
    );
    expect(confirmSpy).toHaveBeenCalled();
    expect(onRemoveMapping).toHaveBeenCalledWith("map-1");
    confirmSpy.mockRestore();
  });

  it("reorders siblings and keeps forbidden actions visible with reasons", async () => {
    const onUpdateModule = vi.fn().mockResolvedValue(undefined);
    const sibling: ParameterModule = {
      ...modules[1]!,
      id: "mod-group-2",
      name: "SC8571",
      sortOrder: 10
    };

    render(
      <ModuleAttributionTree
        canAdmin
        modules={[...modules, sibling]}
        mappings={mappings}
        onUpdateModule={onUpdateModule}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRemoveMapping={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "SC8562 更多操作" }));
    expect(screen.getByRole("menuitem", { name: "上移 SC8562" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "上移 SC8562" })).toHaveAttribute(
      "title",
      "已在同级最前。"
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "下移 SC8562" }));
    await waitFor(() => {
      expect(onUpdateModule).toHaveBeenCalledTimes(2);
    });
    expect(onUpdateModule).toHaveBeenNthCalledWith(1, "mod-group", { sortOrder: 10 });
    expect(onUpdateModule).toHaveBeenNthCalledWith(2, "mod-group-2", { sortOrder: 0 });

    fireEvent.click(screen.getByRole("button", { name: "展开 SC8562 子模块" }));
    fireEvent.click(screen.getByRole("button", { name: "sc8562 更多操作" }));
    expect(screen.getByRole("menuitem", { name: "删除模块 sc8562" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "删除模块 sc8562" })).toHaveAttribute(
      "title",
      "节点类型不可删除，请改挂到其它父级或联系运维。"
    );
  });

  it("keeps the edit dialog open with an inline error when the save mutation rejects", async () => {
    const onUpdateModule = vi.fn().mockRejectedValue(new Error("保存冲突：模块已被其他管理员修改"));

    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        onUpdateModule={onUpdateModule}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRemoveMapping={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "修改模块 Power" }));
    const editDialog = screen.getByRole("dialog", { name: "修改模块 Power" });
    fireEvent.change(within(editDialog).getByLabelText("模块重要性"), {
      target: { value: "low" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onUpdateModule).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog", { name: "修改模块 Power" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog", { name: "修改模块 Power" })).getByRole("alert")
    ).toHaveTextContent("保存冲突：模块已被其他管理员修改");
  });

  it("closes the edit dialog only after the save mutation resolves", async () => {
    let resolveSave!: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const onUpdateModule = vi.fn(() => savePromise);

    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        onUpdateModule={onUpdateModule}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRemoveMapping={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "修改模块 Power" }));
    const editDialog = screen.getByRole("dialog", { name: "修改模块 Power" });
    fireEvent.change(within(editDialog).getByLabelText("模块重要性"), {
      target: { value: "low" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));

    // Pending: dialog stays open until the mutation settles.
    expect(screen.getByRole("dialog", { name: "修改模块 Power" })).toBeInTheDocument();
    resolveSave();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "修改模块 Power" })).not.toBeInTheDocument();
    });
  });

  it("edits importance inside the module dialog, not on the tree row", () => {
    const onUpdateModule = vi.fn();

    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        onUpdateModule={onUpdateModule}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRemoveMapping={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).queryByText("高")).not.toBeInTheDocument();
    expect(within(tree).queryByRole("button", { name: /修改重要性 Power/ })).not.toBeInTheDocument();
    expect(within(tree).queryByRole("combobox", { name: "重要性 Power" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "修改模块 Power" }));
    const editDialog = screen.getByRole("dialog", { name: "修改模块 Power" });
    expect(within(editDialog).getByLabelText("模块重要性")).toHaveValue("high");
    fireEvent.change(within(editDialog).getByLabelText("模块重要性"), {
      target: { value: "low" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));
    expect(onUpdateModule).toHaveBeenCalledWith("mod-power", {
      name: "Power",
      description: "电源业务",
      scope: "组织",
      importance: "low",
      kind: "business"
    });
  });

  it("opens create and edit dialogs for module details including importance", async () => {
    const onCreateModule = vi.fn();
    const onUpdateModule = vi.fn();

    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        onUpdateModule={onUpdateModule}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRemoveMapping={vi.fn()}
        onCreateModule={onCreateModule}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "新建模块" }));
    const createDialog = screen.getByRole("dialog", { name: "新建模块" });
    fireEvent.change(within(createDialog).getByLabelText("模块名称"), {
      target: { value: "热管理" }
    });
    fireEvent.change(within(createDialog).getByLabelText("模块重要性"), {
      target: { value: "high" }
    });
    fireEvent.change(within(createDialog).getByLabelText("模块展示描述"), {
      target: { value: "散热相关" }
    });
    fireEvent.change(within(createDialog).getByLabelText("适用范围"), {
      target: { value: "组织" }
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "创建" }));
    expect(onCreateModule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "热管理",
        description: "散热相关",
        scope: "组织",
        importance: "high",
        parentId: null,
        kind: "business"
      })
    );
    // The dialog closes once the awaited create mutation resolves.
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "新建模块" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "修改模块 Power" }));
    const editDialog = screen.getByRole("dialog", { name: "修改模块 Power" });
    fireEvent.change(within(editDialog).getByLabelText("模块展示描述"), {
      target: { value: "更新后的电源说明" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));
    expect(onUpdateModule).toHaveBeenCalledWith("mod-power", {
      name: "Power",
      description: "更新后的电源说明",
      scope: "组织",
      importance: "high",
      kind: "business"
    });
  });

  it("filters the tree through kind and origin multi-select dropdowns", () => {
    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRemoveMapping={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    const filters = screen.getByLabelText("模块树筛选");
    fireEvent.click(within(filters).getByRole("button", { name: /类型/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "驱动组" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "节点类型" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "未分类" }));

    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).getByText("Power")).toBeInTheDocument();
    expect(within(tree).queryByText("SC8562")).not.toBeInTheDocument();
  });

  it("lets admins view the unclassified root via dialog or queue handoff", () => {
    const onOpenUnclassifiedQueue = vi.fn();
    const unclassified: ParameterModule = {
      id: "mod-unclassified",
      name: "未分类",
      parentId: null,
      sortOrder: 99,
      description: "",
      scope: "",
      importance: "medium",
      kind: "unclassified",
      origin: "auto",
      sourceKey: null,
      effectiveImportance: "medium",
      parameterCount: 20
    };

    const { rerender } = render(
      <ModuleAttributionTree
        canAdmin
        modules={[...modules, unclassified]}
        mappings={mappings}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRemoveMapping={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).queryByRole("button", { name: "修改模块 未分类" })).not.toBeInTheDocument();
    const unclassifiedRow = within(tree).getByRole("treeitem", { name: /未分类/ });
    expect(within(unclassifiedRow).getByText("自动发现")).toBeInTheDocument();
    // Name already says 未分类 — do not repeat the kind badge.
    expect(within(unclassifiedRow).getAllByText("未分类")).toHaveLength(1);
    fireEvent.click(within(tree).getByRole("button", { name: "查看 未分类" }));
    const viewDialog = screen.getByRole("dialog", { name: "查看未分类" });
    expect(viewDialog).toBeInTheDocument();
    const closeButtons = within(viewDialog).getAllByRole("button", { name: "关闭" });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);

    rerender(
      <ModuleAttributionTree
        canAdmin
        hasUnclassifiedQueue
        onOpenUnclassifiedQueue={onOpenUnclassifiedQueue}
        modules={[...modules, unclassified]}
        mappings={mappings}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRemoveMapping={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    fireEvent.click(within(tree).getByRole("button", { name: "查看 未分类" }));
    expect(onOpenUnclassifiedQueue).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "查看未分类" })).not.toBeInTheDocument();
  });

  it("shows overlay coverage chip when fully covered by organization schema", () => {
    const overlayGroup: ParameterModule = {
      ...modules[1]!,
      id: "mod-overlay",
      name: "OverlayDG"
    };
    const coverage = new Map([
      ["mod-overlay", { total: 1, covered: 1, overlayCovered: 1, platformCovered: 0, shadowedCount: 0, promotedCount: 0 }]
    ]);

    render(
      <ModuleAttributionTree
        canAdmin
        modules={[modules[0]!, overlayGroup]}
        mappings={[]}
        driverCoverage={coverage}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRemoveMapping={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).getByText("· 组织级解析覆盖")).toBeInTheDocument();
  });

  it("shows parse coverage chips and filters to uncovered driver groups", () => {
    const coveredGroup: ParameterModule = {
      ...modules[1]!,
      id: "mod-covered",
      name: "CoveredDG",
      parameterCount: 2
    };
    const uncoveredGroup: ParameterModule = {
      ...modules[1]!,
      id: "mod-uncovered",
      name: "UncoveredDG",
      parameterCount: 0,
      origin: "curated"
    };
    const coverage = new Map([
      ["mod-covered", { total: 2, covered: 2, overlayCovered: 0, platformCovered: 2, shadowedCount: 0, promotedCount: 0 }],
      ["mod-uncovered", { total: 2, covered: 0, overlayCovered: 0, platformCovered: 0, shadowedCount: 0, promotedCount: 0 }],
      ["mod-group", { total: 2, covered: 1, overlayCovered: 0, platformCovered: 1, shadowedCount: 0, promotedCount: 0 }]
    ]);
    const details = new Map([
      [
        "mod-group",
        [
          { compatible: "vendor,sc8562", covered: true, pattern: "vendor,sc8562" },
          { compatible: "vendor,other", covered: false }
        ]
      ]
    ]);

    render(
      <ModuleAttributionTree
        canAdmin
        modules={[modules[0]!, modules[1]!, coveredGroup, uncoveredGroup]}
        mappings={[
          ...mappings,
          {
            id: "map-2",
            moduleId: "mod-group",
            matchKind: "compatible",
            matchValue: "vendor,other",
            priority: 100
          }
        ]}
        driverCoverage={coverage}
        driverCoverageDetails={details}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRemoveMapping={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).getByText("· 平台级解析覆盖")).toBeInTheDocument();
    expect(within(tree).getByText("· 解析未覆盖")).toBeInTheDocument();
    expect(within(tree).getByText("· 解析覆盖 1/2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "仅显示解析未覆盖" }));
    expect(within(tree).queryByText("CoveredDG")).not.toBeInTheDocument();
    expect(within(tree).getByText("UncoveredDG")).toBeInTheDocument();
    expect(within(tree).getByText("SC8562")).toBeInTheDocument();

    fireEvent.click(within(tree).getByRole("button", { name: "修改模块 SC8562" }));
    const editDialog = screen.getByRole("dialog", { name: "修改模块 SC8562" });
    expect(within(editDialog).getByText("官方解析覆盖")).toBeInTheDocument();
    expect(within(editDialog).getByText("解析未覆盖")).toBeInTheDocument();
  });

  it("closes the module editor before handing off to overlay schema authoring", () => {
    const onAuthorOverlaySchema = vi.fn();
    const uncovered = new Map([
      [
        "mod-group",
        [
          {
            compatible: "vendor,orphan",
            coverage: { covered: false, pattern: null, driverId: null, source: null }
          }
        ]
      ]
    ]);

    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={[
          {
            id: "map-orphan",
            moduleId: "mod-group",
            matchKind: "compatible",
            matchValue: "vendor,orphan",
            priority: 100
          }
        ]}
        driverCoverageDetails={uncovered}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRemoveMapping={vi.fn()}
        onCreateModule={vi.fn()}
        onAuthorOverlaySchema={onAuthorOverlaySchema}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "修改模块 SC8562" }));
    expect(screen.getByRole("dialog", { name: "修改模块 SC8562" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "配置组织级解析" }));
    expect(onAuthorOverlaySchema).toHaveBeenCalledWith("vendor,orphan");
    expect(screen.queryByRole("dialog", { name: "修改模块 SC8562" })).not.toBeInTheDocument();
  });
});
