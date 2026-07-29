import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { ModuleCreateDialog } from "./ModuleCreateDialog";

const modules: ParameterModule[] = [
  {
    id: "biz-1",
    name: "Power",
    parentId: null,
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "high",
    kind: "business",
    origin: "curated",
    sourceKey: null,
    effectiveImportance: "high",
    parameterCount: 0
  },
  {
    id: "dg-1",
    name: "sc8562",
    parentId: "biz-1",
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "medium",
    kind: "driver-group",
    origin: "curated",
    sourceKey: null,
    effectiveImportance: "high",
    parameterCount: 0
  }
];

describe("ModuleCreateDialog", () => {
  it("creates a root module from the dialog", () => {
    const onCreate = vi.fn();
    render(<ModuleCreateDialog existingNames={[]} onCreate={onCreate} onCancel={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "新增根模块" })).toBeInTheDocument();
    expect(screen.queryByText("模块名称不能为空")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("模块名称"), { target: { value: "Custom Power" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "Custom Power",
      description: "",
      scope: ""
    });
  });

  it("creates a child module with parent context", () => {
    const onCreate = vi.fn();
    render(
      <ModuleCreateDialog
        existingNames={["Battery Health"]}
        parentName="Battery Estimation"
        onCreate={onCreate}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "在 Battery Estimation 下创建子模块" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("模块名称"), { target: { value: "SOC Model" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "SOC Model",
      description: "",
      scope: ""
    });
  });

  it("creates a driver-group with required compatibles in attribution mode", () => {
    const onCreate = vi.fn();
    render(
      <ModuleCreateDialog
        existingNames={[]}
        allowKindSelect
        modules={modules}
        initialParentId={null}
        onCreate={onCreate}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "新建模块" });
    fireEvent.change(within(dialog).getByLabelText("模块类型"), {
      target: { value: "driver-group" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "父级" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Power" }));
    fireEvent.change(within(dialog).getByLabelText("模块名称"), {
      target: { value: "hl7603" }
    });
    expect(within(dialog).getByRole("button", { name: "创建" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Exact compatible"), {
      target: { value: "huawei,bypass_bst_hl7603" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "hl7603",
        kind: "driver-group",
        parentId: "biz-1",
        compatibles: ["huawei,bypass_bst_hl7603"]
      })
    );
  });
});
