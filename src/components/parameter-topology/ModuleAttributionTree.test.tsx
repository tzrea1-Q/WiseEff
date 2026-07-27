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
  it("scopes actions by kind and shows rules on the driver-group row", () => {
    const onDelete = vi.fn();
    const onRemoveMapping = vi.fn();

    render(
      <ModuleAttributionTree
        canAdmin
        modules={modules}
        mappings={mappings}
        onRename={vi.fn()}
        onMove={vi.fn()}
        onDelete={onDelete}
        onImportanceChange={vi.fn()}
        onRemoveMapping={onRemoveMapping}
        onCreateBusinessModule={vi.fn()}
      />
    );

    const tree = screen.getByRole("tree", { name: "模块归属树" });
    expect(within(tree).getByText("业务分类")).toBeInTheDocument();
    expect(within(tree).getByText("驱动组")).toBeInTheDocument();
    expect(within(tree).getByText("compatible:vendor,sc8562")).toBeInTheDocument();

    expect(within(tree).getByRole("button", { name: "解散驱动组 SC8562" })).toBeInTheDocument();
    expect(within(tree).queryByRole("button", { name: /删除模块 sc8562@6E/ })).not.toBeInTheDocument();
    expect(within(tree).queryByRole("button", { name: /移动模块 sc8562@6E/ })).not.toBeInTheDocument();

    // Driver groups expand by default; instances are visible underneath.
    expect(within(tree).getByText("器件实例")).toBeInTheDocument();
    expect(within(tree).getByRole("button", { name: "重命名模块 sc8562@6E" })).toBeInTheDocument();

    fireEvent.click(
      within(tree).getByRole("button", { name: "删除归属 compatible:vendor,sc8562" })
    );
    expect(onRemoveMapping).toHaveBeenCalledWith("map-1");
  });
});
