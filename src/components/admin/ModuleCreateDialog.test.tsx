import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModuleCreateDialog } from "./ModuleCreateDialog";


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

    expect(screen.getByRole("dialog", { name: "在「Battery Estimation」下创建子模块" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("模块名称"), { target: { value: "SOC Model" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "SOC Model",
      description: "",
      scope: ""
    });
  });

  it("ignores withdrawn identity options while business taxonomy creation works", () => {
    const onCreate = vi.fn();
    const retiredIdentityOptions = { allowKindSelect: true };
    render(
      <ModuleCreateDialog
        existingNames={[]}
        {...retiredIdentityOptions}
        onCreate={onCreate}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("模块类型")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Exact compatible")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("sourceKey")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("模块名称"), { target: { value: "Charging Policy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    expect(onCreate).toHaveBeenCalledWith({ name: "Charging Policy", description: "", scope: "" });
  });
});
