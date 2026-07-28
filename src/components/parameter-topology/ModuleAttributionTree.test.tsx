import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    id: "mod-instance",
    name: "sc8562@6E",
    parentId: "mod-group",
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "medium",
    kind: "instance",
    origin: "auto",
    sourceKey: "node:/amba/sc8562@6E",
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
        onCreateBusinessModule={vi.fn()}
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
    expect(within(tree).queryByRole("button", { name: /删除模块 sc8562@6E/ })).not.toBeInTheDocument();
    expect(within(tree).queryByRole("button", { name: /移动模块 sc8562@6E/ })).not.toBeInTheDocument();

    // Business expands by default; driver groups stay collapsed with instance counts.
    expect(within(tree).getByText("· 1 实例")).toBeInTheDocument();
    expect(within(tree).queryByText("器件实例")).not.toBeInTheDocument();

    fireEvent.click(within(tree).getByRole("button", { name: "展开 SC8562 子模块" }));
    expect(within(tree).getByText("器件实例")).toBeInTheDocument();
    expect(within(tree).getByRole("button", { name: "修改模块 sc8562@6E" })).toBeInTheDocument();
    // Instance only exposes edit; no overflow menu.
    expect(within(tree).queryByRole("button", { name: "sc8562@6E 更多操作" })).not.toBeInTheDocument();

    fireEvent.click(within(tree).getByRole("button", { name: "SC8562 更多操作" }));
    expect(screen.getByRole("menuitem", { name: "解散驱动组 SC8562" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "移动模块 SC8562" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /添加子模块到 SC8562/ })).not.toBeInTheDocument();

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
        onCreateBusinessModule={vi.fn()}
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

  it("opens create and edit dialogs for module details including importance", () => {
    const onCreateBusinessModule = vi.fn();
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
        onCreateBusinessModule={onCreateBusinessModule}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "新建业务分类" }));
    const createDialog = screen.getByRole("dialog", { name: "新增根模块" });
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
    expect(onCreateBusinessModule).toHaveBeenCalledWith({
      name: "热管理",
      description: "散热相关",
      scope: "组织",
      importance: "high",
      parentId: null
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
        onCreateBusinessModule={vi.fn()}
      />
    );

    const filters = screen.getByLabelText("模块树筛选");
    fireEvent.click(within(filters).getByRole("button", { name: /类型/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "驱动组" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "器件实例" }));
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
        onCreateBusinessModule={vi.fn()}
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
        onCreateBusinessModule={vi.fn()}
      />
    );

    fireEvent.click(within(tree).getByRole("button", { name: "查看 未分类" }));
    expect(onOpenUnclassifiedQueue).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "查看未分类" })).not.toBeInTheDocument();
  });
});
