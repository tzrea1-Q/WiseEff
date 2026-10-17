import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { selectControlOption } from "@/test/selectControlOption";

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
    parameterCount: 8,
    definitionCount: 3
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
    parameterCount: 8,
    definitionCount: 3
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
    parameterCount: 4,
    definitionCount: 2
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
  it("closes a portal action menu when another mutation becomes pending", () => {
    const onUpdateModule = vi.fn();
    const tree = (busy: boolean) => <ModuleAttributionTree canAdmin modules={modules} mappings={[]} busy={busy}
      onUpdateModule={onUpdateModule} onMove={vi.fn()} onDelete={vi.fn()} onCreateModule={vi.fn()} />;
    const view = render(tree(false));
    fireEvent.click(screen.getByRole("button", { name: "Power 更多操作" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    view.rerender(tree(true));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Power 更多操作" })).toBeDisabled();
    expect(onUpdateModule).not.toHaveBeenCalled();
  });
  it("restores tree filters and disclosures from URL across remount and Back/Forward without replacing the input", async () => {
    const onSearchChange = vi.fn();
    const tree = (search: string) => <ModuleAttributionTree modules={modules} mappings={[]} search={search}
      onSearchChange={onSearchChange} onUpdateModule={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} onCreateModule={vi.fn()} />;
    let view = render(tree("?moduleId=mod-power"));
    const input = screen.getByRole("searchbox", { name: "搜索模块" });
    await userEvent.type(input, "SC8562");
    const query = onSearchChange.mock.lastCall![0] as string;
    expect(new URLSearchParams(query).get("treeQ")).toBe("SC8562");
    expect(input).toHaveFocus();
    view.rerender(tree(`?moduleId=mod-power&${query}`));
    expect(screen.getByRole("searchbox", { name: "搜索模块" })).toBe(input);
    expect(input).toHaveValue("SC8562");
    view.rerender(tree("?moduleId=mod-power"));
    expect(input).toHaveValue("");
    view.rerender(tree(`?${query}`));
    expect(input).toHaveValue("SC8562");
    view.unmount();
    view = render(tree(`?${query}`));
    expect(screen.getByRole("searchbox", { name: "搜索模块" })).toHaveValue("SC8562");
    expect(screen.getByText("sc8562")).toBeVisible();
    view.unmount();
    const filtered = render(tree(`?treeKinds=business&treeOrigins=curated&treeHideUnobserved=1&treeExpanded=${encodeURIComponent("[]")}`));
    expect(screen.queryByRole("checkbox", { name: "隐藏未实测" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 Power 子模块" }));
    expect(screen.getByText("SC8562")).toBeVisible();
    filtered.rerender(tree(`?treeExpanded=${encodeURIComponent("[]")}`));
    expect(screen.getByRole("button", { name: "展开 Power 子模块" })).toHaveAttribute("aria-expanded", "false");
  });
  it("opens a requested root creation once and keeps the administrator gate", () => {
    const tree = (request: number, canAdmin: boolean) => <ModuleAttributionTree modules={modules} mappings={[]}
      canAdmin={canAdmin} createRootRequest={request} onUpdateModule={vi.fn()} onMove={vi.fn()}
      onDelete={vi.fn()} onCreateModule={vi.fn()} />;
    const view = render(tree(0, false));
    view.rerender(tree(1, false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(tree(1, true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(tree(2, true));
    expect(screen.getByRole("dialog", { name: "新增根模块" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    view.rerender(tree(2, true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.unmount();
    render(tree(2, true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("reports only matching module IDs, excluding structural ancestors, and restores an unrestricted scope", async () => {
    const onVisibleModuleIdsChange = vi.fn();
    render(<ModuleAttributionTree modules={modules} mappings={[]} onVisibleModuleIdsChange={onVisibleModuleIdsChange}
      onUpdateModule={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} onCreateModule={vi.fn()} />);
    expect(onVisibleModuleIdsChange).toHaveBeenLastCalledWith(null);
    const search = screen.getByRole("searchbox", { name: "搜索模块" });
    fireEvent.change(search, { target: { value: "SC8562" } });
    expect(onVisibleModuleIdsChange).toHaveBeenLastCalledWith(["mod-group", "mod-node-type"]);
    expect(screen.getByText("Power")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "no-such-module" } });
    expect(onVisibleModuleIdsChange).toHaveBeenLastCalledWith([]);
    fireEvent.change(search, { target: { value: "" } });
    expect(onVisibleModuleIdsChange).toHaveBeenLastCalledWith(null);
  });
  it("reveals a selected deep module and searches names without losing ancestors", async () => {
    const renderTree = (selectedModuleId: string | null) => <ModuleAttributionTree modules={modules} mappings={[]}
      selectedModuleId={selectedModuleId} onSelectModule={vi.fn()} onUpdateModule={vi.fn()}
      onMove={vi.fn()} onDelete={vi.fn()} onCreateModule={vi.fn()} />;
    const view = render(renderTree("mod-node-type"));
    expect(await screen.findByRole("button", { name: "查看模块：sc8562" })).toBeVisible();
    expect(screen.getByRole("button", { name: "折叠 SC8562" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索模块" }), "sc8562");
    expect(screen.getByRole("button", { name: "查看模块：Power" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看模块：sc8562" })).toBeVisible();
    view.rerender(renderTree(null));
    expect(screen.getByRole("searchbox", { name: "搜索模块" })).toHaveValue("sc8562");
  });

  it("provides roving tree keys, explicit activation, and keyboard access to the action menu", async () => {
    const onSelectModule = vi.fn();
    render(<ModuleAttributionTree canAdmin modules={modules} mappings={[]} onSelectModule={onSelectModule}
      onUpdateModule={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} onCreateModule={vi.fn()} />);
    const user = userEvent.setup();
    const tree = screen.getByRole("tree");
    const root = within(tree).getAllByRole("treeitem")[0];
    await user.click(screen.getByRole("button", { name: "查看模块：Power" }));
    expect(root).toHaveFocus();
    onSelectModule.mockClear();
    await user.keyboard("{ArrowRight}");
    const group = document.activeElement;
    expect(group).toHaveAttribute("data-module-tree-id", "mod-group");
    expect(onSelectModule).not.toHaveBeenCalled();
    await user.keyboard("{ArrowRight}{ArrowRight}{Enter}");
    expect(document.activeElement).toHaveAttribute("data-module-tree-id", "mod-node-type");
    expect(onSelectModule).toHaveBeenCalledWith("mod-node-type");
    await user.keyboard("{Home}{ArrowLeft}{End}{Home}");
    expect(document.activeElement).toBe(root);
    const trigger = screen.getByRole("button", { name: "Power 更多操作" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("role", "menuitem");
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveAccessibleName("删除模块 Power");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("starts navigation with search without module filters, duplicate headings or all-modules rows", () => {
    render(<ModuleAttributionTree modules={modules} mappings={[]} onSelectModule={vi.fn()}
      onUpdateModule={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} onCreateModule={vi.fn()} />);
    expect(screen.getByRole("searchbox", { name: "搜索模块" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "模块树" })).not.toBeInTheDocument();
    expect(screen.queryByText("选择模块查看所属主体，包含其子模块。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全部模块" })).not.toBeInTheDocument();
    expect(screen.queryByText("筛选模块", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("模块树筛选")).not.toBeInTheDocument();
  });

  it("opens complete read-only module details for readers without exposing a write", () => {
    const onUpdateModule = vi.fn();
    render(<ModuleAttributionTree modules={modules} mappings={[]} onUpdateModule={onUpdateModule}
      onMove={vi.fn()} onDelete={vi.fn()} onCreateModule={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "查看模块 Power" }));
    const dialog = screen.getByRole("dialog", { name: "Power" });
    expect(dialog).toHaveTextContent("模块详情 · 只读");
    expect(within(dialog).getByLabelText("模块名称")).toHaveAttribute("readonly");
    expect(within(dialog).queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(onUpdateModule).not.toHaveBeenCalled();
  });
  it("exposes the unselected state of module tree items", () => {
    render(<ModuleAttributionTree canAdmin modules={modules} mappings={[]}
      onUpdateModule={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} onCreateModule={vi.fn()} />);
    for (const item of screen.getAllByRole("treeitem")) expect(item).toHaveAttribute("aria-selected", "false");
  });

  it.each([
    ["driver-group", "up"], ["driver-group", "down"],
    ["node-type", "up"], ["node-type", "down"]
  ] as const)("blocks canonical reorder across historical %s siblings in direction %s before any write", async (kind, direction) => {
    const business = { ...modules[0]!, sortOrder: 10 };
    const historical = { ...modules[1]!, kind, parentId: null,
      sortOrder: direction === "up" ? 0 : 20 };
    const onUpdateModule = vi.fn(async (moduleId: string) => {
      if (moduleId === historical.id) throw new Error("legacy-surface-retired");
    });
    render(<ModuleAttributionTree canAdmin modules={[business, historical]} mappings={[]}
      onUpdateModule={onUpdateModule} onMove={vi.fn()} onDelete={vi.fn()} onCreateModule={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Power 更多操作" }));
    const reorder = screen.getByRole("menuitem", { name: `${direction === "up" ? "上移" : "下移"} Power` });
    await act(async () => { fireEvent.click(reorder); });
    expect(onUpdateModule).not.toHaveBeenCalled();
    expect(reorder).toBeDisabled();
    expect(reorder).toHaveAttribute("title", "相邻历史主体为只读，不能交换排序。");
  });

  it.each(["up", "down"] as const)(
    "preserves business-business reorder in direction %s",
    async (direction) => {
      const business = { ...modules[0]!, sortOrder: 0 };
      const peer = { ...business, id: "mod-business-peer", name: "Thermal", sortOrder: 10 };
      const onUpdateModule = vi.fn().mockResolvedValue(undefined);
      render(<ModuleAttributionTree canAdmin
        modules={[business, peer]} mappings={[]} onUpdateModule={onUpdateModule}
        onMove={vi.fn()} onDelete={vi.fn()} onCreateModule={vi.fn()} />);
      const source = direction === "up" ? peer : business;
      const target = direction === "up" ? business : peer;
      fireEvent.click(screen.getByRole("button", { name: `${source.name} 更多操作` }));
      const reorder = screen.getByRole("menuitem", { name: `${direction === "up" ? "上移" : "下移"} ${source.name}` });
      expect(reorder).toBeEnabled();
      fireEvent.click(reorder);
      await waitFor(() => expect(onUpdateModule).toHaveBeenCalledTimes(2));
      expect(onUpdateModule).toHaveBeenNthCalledWith(1, source.id, { sortOrder: target.sortOrder });
      expect(onUpdateModule).toHaveBeenNthCalledWith(2, target.id, { sortOrder: source.sortOrder });
    }
  );

  it("keeps taxonomy menus on business categories without offering legacy subject mutations", () => {
    render(<ModuleAttributionTree canAdmin modules={modules} mappings={[]}
      onUpdateModule={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} onCreateModule={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Power 更多操作" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SC8562 更多操作" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看模块 SC8562" }));
    expect(within(screen.getByRole("dialog")).queryByLabelText("模块类型")).not.toBeInTheDocument();
  });

  it("routes canonical-only driver groups to canonical placement without legacy actions", () => {
    const onUpdateModule = vi.fn();
    const onOpenCanonicalPlacement = vi.fn();
    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        driverRegistrationByModuleId={new Map([
          ["mod-group", {
            driverNature: null,
            instanceCardinality: null,
            defaultBusinessCategoryId: null
          }]
        ])}
        canonicalPlacementAvailable
        onOpenCanonicalPlacement={onOpenCanonicalPlacement}
        onUpdateModule={onUpdateModule}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看模块 SC8562" }));
    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).queryByRole("region", { name: "业务归属" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("默认业务分类")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "从注册回放放置" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "管理规范主体与归属" }));
    expect(onOpenCanonicalPlacement).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "SC8562" })).not.toBeInTheDocument();
    expect(onUpdateModule).not.toHaveBeenCalled();
  });

  it("shows historical driver provenance read-only while keeping canonical placement available", () => {
    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        driverRegistrationByModuleId={new Map([
          ["mod-group", {
            driverNature: "physical-device",
            instanceCardinality: "multiple",
            defaultBusinessCategoryId: null,
            compatibles: ["vendor,sc8562"]
          }]
        ])}
        canonicalPlacementAvailable
        onOpenCanonicalPlacement={vi.fn()}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看模块 SC8562" }));
    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).getByRole("region", { name: "历史 compatible 溯源" })).toHaveTextContent("vendor,sc8562");
    expect(within(dialog).getByLabelText("驱动性质")).toHaveAttribute("readonly");
    expect(within(dialog).getByLabelText("实例基数")).toHaveAttribute("readonly");
    expect(within(dialog).queryByLabelText("默认业务分类")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "从注册回放放置" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "规范主体放置" })).toBeInTheDocument();
  });

  it("withdraws legacy placement controls in mock mode", () => {
    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        driverRegistrationByModuleId={new Map([
          ["mod-group", {
            driverNature: null,
            instanceCardinality: null,
            defaultBusinessCategoryId: null
          }]
        ])}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看模块 SC8562" }));
    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).queryByRole("region", { name: "业务归属" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("默认业务分类")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "从注册回放放置" })).not.toBeInTheDocument();
  });

  it("suppresses legacy placement actions if canonical mode is enabled but its panel is unavailable", () => {
    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        driverRegistrationByModuleId={new Map([
          ["mod-group", {
            driverNature: null,
            instanceCardinality: null,
            defaultBusinessCategoryId: null
          }]
        ])}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看模块 SC8562" }));
    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).queryByRole("region", { name: "业务归属" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: "规范主体放置" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("默认业务分类")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "从注册回放放置" })).not.toBeInTheDocument();
  });

  it("keeps historical rule summaries without offering driver identity mutations", () => {
    const onUpdateModule = vi.fn();
    const onDelete = vi.fn();
    render(<ModuleAttributionTree canAdmin modules={modules} mappings={mappings}
      onUpdateModule={onUpdateModule} onMove={vi.fn()} onDelete={onDelete} onCreateModule={vi.fn()} />);
    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).getByText("· 1 条 compatible")).toBeInTheDocument();
    expect(within(tree).queryByRole("button", { name: "SC8562 更多操作" })).not.toBeInTheDocument();
    fireEvent.click(within(tree).getByRole("button", { name: "查看模块 SC8562" }));
    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).getByLabelText("模块名称")).toHaveAttribute("readonly");
    expect(within(dialog).queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /移除|添加 compatible/ })).not.toBeInTheDocument();
    expect(onUpdateModule).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("keeps the delete confirmation open with an inline error when deletion fails", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error("仍有参数引用，服务端拒绝删除"));

    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={onDelete}
        onCreateModule={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Power 更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除模块 Power" }));
    const confirmDialog = screen.getByRole("dialog", { name: "删除模块「Power」" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("mod-power"));
    expect(screen.getByRole("dialog", { name: "删除模块「Power」" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog", { name: "删除模块「Power」" })).getByRole("alert")
    ).toHaveTextContent("仍有参数引用，服务端拒绝删除");
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
        onCreateModule={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "修改模块 Power" }));
    const editDialog = screen.getByRole("dialog", { name: "Power" });
    await selectControlOption(within(editDialog).getByLabelText("模块重要性"), "low");
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onUpdateModule).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog", { name: "Power" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog", { name: "Power" })).getByRole("alert")
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
        onCreateModule={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "修改模块 Power" }));
    const editDialog = screen.getByRole("dialog", { name: "Power" });
    await selectControlOption(within(editDialog).getByLabelText("模块重要性"), "low");
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));

    // Pending: dialog stays open until the mutation settles.
    expect(screen.getByRole("dialog", { name: "Power" })).toBeInTheDocument();
    resolveSave();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Power" })).not.toBeInTheDocument();
    });
  });

  it("edits importance inside the module dialog, not on the tree row", async () => {
    const onUpdateModule = vi.fn();

    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        onUpdateModule={onUpdateModule}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).queryByText("高")).not.toBeInTheDocument();
    expect(within(tree).queryByRole("button", { name: /修改重要性 Power/ })).not.toBeInTheDocument();
    expect(within(tree).queryByRole("combobox", { name: "重要性 Power" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "修改模块 Power" }));
    const editDialog = screen.getByRole("dialog", { name: "Power" });
    expect(within(editDialog).getByLabelText("模块重要性")).toHaveAttribute("data-value", "high");
    await selectControlOption(within(editDialog).getByLabelText("模块重要性"), "low");
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));
    expect(onUpdateModule).toHaveBeenCalledWith("mod-power", {
      name: "Power",
      description: "电源业务",
      scope: "组织",
      importance: "low"
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
        onCreateModule={onCreateModule}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "新建模块" }));
    const createDialog = screen.getByRole("dialog");
    fireEvent.change(within(createDialog).getByLabelText("模块名称"), {
      target: { value: "热管理" }
    });
    await selectControlOption(within(createDialog).getByLabelText("模块重要性"), "high");
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
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "修改模块 Power" }));
    const editDialog = screen.getByRole("dialog", { name: "Power" });
    fireEvent.change(within(editDialog).getByLabelText("模块展示描述"), {
      target: { value: "更新后的电源说明" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));
    expect(onUpdateModule).toHaveBeenCalledWith("mod-power", {
      name: "Power",
      description: "更新后的电源说明",
      scope: "组织",
      importance: "high"
    });
  });

  it("ignores retired filter bookmarks and emits only search and expansion state", () => {
    const onSearchChange = vi.fn();
    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        search="?treeKinds=business&treeOrigins=curated&treeHideUnobserved=1&treeOnlyUncovered=1"
        onSearchChange={onSearchChange}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).getByText("Power")).toBeInTheDocument();
    expect(within(tree).getByText("SC8562")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索模块" }), { target: { value: "SC8562" } });
    const query = new URLSearchParams(onSearchChange.mock.lastCall![0]);
    expect(query.get("treeQ")).toBe("SC8562");
    expect([...query.keys()].sort()).toEqual(["treeExpanded", "treeQ"]);
  });

  it("lets admins view the unclassified root read-only without a withdrawn queue handoff", () => {
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
      parameterCount: 20,
      definitionCount: 6
    };

    render(
      <ModuleAttributionTree
        canAdmin
        modules={[...modules, unclassified]}
        mappings={mappings}
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
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
    const viewDialog = screen.getByRole("dialog", { name: "未分类" });
    expect(viewDialog).toBeInTheDocument();
    expect(viewDialog).toHaveTextContent("此处仅展示兜底归属，不提供旧 compatible 归类。");
    expect(within(viewDialog).queryByRole("button", { name: "打开未分类队列" })).not.toBeInTheDocument();
    const closeButtons = within(viewDialog).getAllByRole("button", { name: "关闭" });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);

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
        onCreateModule={vi.fn()}
      />
    );

    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).getByText("· 组织级解析覆盖")).toBeInTheDocument();
  });

  it("shows parse coverage chips without hiding covered driver groups", () => {
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
        onUpdateModule={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onCreateModule={vi.fn()}
      />
    );

    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).getByText("· 平台级解析覆盖")).toBeInTheDocument();
    expect(within(tree).getByText("· 解析未覆盖")).toBeInTheDocument();
    expect(within(tree).getByText("· 解析覆盖 1/2")).toBeInTheDocument();

    expect(screen.queryByRole("checkbox", { name: "仅显示解析未覆盖" })).not.toBeInTheDocument();
    expect(within(tree).getByText("CoveredDG")).toBeInTheDocument();
    expect(within(tree).getByText("UncoveredDG")).toBeInTheDocument();
    expect(within(tree).getByText("SC8562")).toBeInTheDocument();

    fireEvent.click(within(tree).getByRole("button", { name: "查看模块 SC8562" }));
    const editDialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(editDialog).getByLabelText("模块名称")).toHaveAttribute("readonly");
    expect(within(editDialog).queryByRole("button", { name: /编写覆盖解析|添加 compatible/ })).not.toBeInTheDocument();
  });
});
