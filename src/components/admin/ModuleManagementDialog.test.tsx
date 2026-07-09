import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildParameterModuleTree } from "@/parameterAdminLibrary";
import { initialState } from "@/mockData";
import { ModuleManagementDialog } from "./ModuleManagementDialog";

afterEach(() => {
  cleanup();
});

const moduleNodes = buildParameterModuleTree([], initialState.configDraft.parameterModules);

describe("ModuleManagementDialog", () => {
  it("lists modules and dispatches add, update, and delete actions", () => {
    const onAddModule = vi.fn();
    const onUpdateModule = vi.fn();
    const onDeleteModule = vi.fn();

    render(
      <ModuleManagementDialog
        open
        moduleNodes={moduleNodes}
        parameters={initialState.configDraft.parameterLibrary}
        onClose={vi.fn()}
        onAddModule={onAddModule}
        onUpdateModule={onUpdateModule}
        onDeleteModule={onDeleteModule}
        onEditParameterDefinition={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "模块管理" })).toBeInTheDocument();
    expect(screen.getByText("Charging Policy")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新增根模块" }));
    fireEvent.change(screen.getByLabelText("模块名称"), { target: { value: "Custom Power" } });
    fireEvent.change(screen.getByLabelText("模块展示描述"), { target: { value: "自定义电源模块" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(onAddModule).toHaveBeenCalledWith(
      {
        name: "Custom Power",
        description: "自定义电源模块",
        scope: ""
      },
      null
    );

    const standbyRow = screen.getByText("Standby Power").closest("tr");
    expect(standbyRow).not.toBeNull();
    fireEvent.click(within(standbyRow!).getByRole("button", { name: "修改" }));
    const editDialog = screen.getByRole("dialog", { name: /修改模块 Standby Power/ });
    fireEvent.change(within(editDialog).getByLabelText("模块名称"), { target: { value: "Standby Energy" } });
    fireEvent.change(within(editDialog).getByLabelText("模块展示描述"), { target: { value: "待机能耗治理" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));
    const standbyModule = moduleNodes.find((module) => module.name === "Standby Power");
    expect(standbyModule).toBeDefined();
    expect(onUpdateModule).toHaveBeenCalledWith(standbyModule!.id, {
      name: "Standby Energy",
      description: "待机能耗治理",
      scope: "待机场景功耗治理"
    });
  });

  it("filters modules and opens parameter definition from the expanded list", () => {
    const chargingParameter = initialState.configDraft.parameterLibrary.find(
      (parameter) => parameter.module === "Charging Policy" && parameter.name === "fast_charge_current_limit_ma"
    );
    expect(chargingParameter).toBeDefined();
    const onEditParameterDefinition = vi.fn();

    render(
      <ModuleManagementDialog
        open
        moduleNodes={moduleNodes}
        parameters={initialState.configDraft.parameterLibrary}
        onClose={vi.fn()}
        onAddModule={vi.fn()}
        onUpdateModule={vi.fn()}
        onDeleteModule={vi.fn()}
        onEditParameterDefinition={onEditParameterDefinition}
      />
    );

    fireEvent.change(screen.getByLabelText("搜索模块"), { target: { value: "charging" } });
    expect(screen.getByText("Charging Policy")).toBeInTheDocument();
    expect(screen.queryByText("Battery Safety")).not.toBeInTheDocument();

    const chargingRow = screen.getByText("Charging Policy").closest("tr");
    expect(chargingRow).not.toBeNull();
    fireEvent.click(within(chargingRow!).getByRole("button", { name: "查看参数" }));

    const parameterList = screen.getByLabelText("Charging Policy 参数列表");
    const parameterItem = within(parameterList).getByText("fast_charge_current_limit_ma").closest("li");
    expect(parameterItem).not.toBeNull();
    fireEvent.click(within(parameterItem as HTMLElement).getByRole("button", { name: "修改定义" }));
    expect(onEditParameterDefinition).toHaveBeenCalledWith(chargingParameter!.id);
  });
});
