import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ParameterImportWizard } from "./ParameterImportWizard";
import { initialState } from "@/mockData";

function renderWizard(overrides: Partial<ComponentProps<typeof ParameterImportWizard>> = {}) {
  const dispatch = vi.fn();
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  const utils = render(
    <ParameterImportWizard
      open
      onClose={onClose}
      projects={initialState.configDraft.projects}
      parameters={initialState.parameters}
      activeProjectId={initialState.activeProjectId}
      dispatch={dispatch}
      onNavigate={onNavigate}
      runtimeMode="mock"
      {...overrides}
    />
  );
  return { ...utils, dispatch, onClose, onNavigate };
}

describe("ParameterImportWizard", () => {
  it("does not render anything when closed", () => {
    renderWizard({ open: false });

    expect(screen.queryByRole("dialog", { name: "批量参数导入向导" })).not.toBeInTheDocument();
  });

  it("shows step 1 controls with the target project defaulted to the active project", () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    const projectSelect = within(dialog).getByLabelText("目标项目") as HTMLSelectElement;
    expect(projectSelect).toHaveValue(initialState.activeProjectId);

    expect(within(dialog).getByRole("button", { name: "+ 新建项目" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "下载导入模板" })).toBeInTheDocument();

    const fileInput = dialog.querySelector('input[type="file"]');
    expect(fileInput).toHaveAttribute("accept", ".xlsx,.csv,.json,.dts,.dtsi,.txt");

    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeDisabled();
  });

  it("enables next once paste content is provided and a project is selected", () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fireEvent.change(within(dialog).getByLabelText("粘贴导入内容（可选）"), {
      target: { value: '[{"name":"x"}]' }
    });

    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeEnabled();
  });

  it("closes when the close icon is clicked", () => {
    const { onClose } = renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the project creation dialog and dispatches a local project in mock mode", () => {
    const { dispatch } = renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fireEvent.click(within(dialog).getByRole("button", { name: "+ 新建项目" }));

    const createDialog = screen.getByRole("dialog", { name: "新建项目" });
    fireEvent.change(within(createDialog).getByLabelText("项目名称"), { target: { value: "新项目" } });
    fireEvent.change(within(createDialog).getByLabelText("项目代号"), { target: { value: "NEW1" } });
    fireEvent.click(within(createDialog).getByRole("button", { name: "创建项目" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_PARAMETER_ADMIN_PROJECT",
      project: { id: "new1", name: "新项目", code: "NEW1" }
    });
    expect(screen.queryByRole("dialog", { name: "新建项目" })).not.toBeInTheDocument();
  });

  it("parses a pasted JSON fixture and shows the Step 2 parse summary counts", () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fireEvent.change(within(dialog).getByLabelText("粘贴导入内容（可选）"), {
      target: {
        value: JSON.stringify([
          {
            name: "new_wizard_test_param",
            module: "Wizard Test Module",
            currentValue: "1",
            recommendedValue: "2",
            range: "0 - 10",
            unit: "unit",
            risk: "Low"
          }
        ])
      }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    expect(within(dialog).getByRole("region", { name: "解析与校验" })).toBeInTheDocument();
    const summary = within(dialog).getByRole("region", { name: "解析与校验" });
    expect(within(summary).getByText("总行数").nextElementSibling).toHaveTextContent("1");
    expect(within(summary).getByText("新增候选").nextElementSibling).toHaveTextContent("1");
    expect(within(summary).getByText("已有").nextElementSibling).toHaveTextContent("0");
    expect(within(summary).getByText("冲突").nextElementSibling).toHaveTextContent("0");
    expect(within(summary).getByText("待补全模块").nextElementSibling).toHaveTextContent("0");
    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeEnabled();
  });

  it("enables Step 3 next once every row has been approved", () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fireEvent.change(within(dialog).getByLabelText("粘贴导入内容（可选）"), {
      target: {
        value: JSON.stringify([
          {
            name: "fast_charge_current_limit_ma",
            module: "Charging Policy",
            currentValue: "3200",
            recommendedValue: "3400",
            range: "2500 - 4500",
            unit: "mA",
            risk: "High"
          }
        ])
      }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    expect(within(dialog).getByRole("region", { name: "逐行核对" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "通过" }));

    expect(within(dialog).getByText("已核对 1/1")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeEnabled();
  });

  it("blocks advancing past Step 2 when parsing produces zero rows", () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fireEvent.change(within(dialog).getByLabelText("粘贴导入内容（可选）"), {
      target: { value: "not,valid,parameter,rows" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeDisabled();
  });

  it("changing target project after step 3 triggers confirm dialog and resets review state", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fireEvent.change(within(dialog).getByLabelText("粘贴导入内容（可选）"), {
      target: {
        value: JSON.stringify([
          {
            name: "fast_charge_current_limit_ma",
            module: "Charging Policy",
            currentValue: "3200",
            recommendedValue: "3400",
            range: "2500 - 4500",
            unit: "mA",
            risk: "High"
          }
        ])
      }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    expect(within(dialog).getByRole("region", { name: "逐行核对" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "通过" }));
    expect(within(dialog).getByText("已核对 1/1")).toBeInTheDocument();

    const otherProject = initialState.configDraft.projects.find((project) => project.id !== initialState.activeProjectId);
    expect(otherProject).toBeDefined();

    fireEvent.change(within(dialog).getByLabelText("目标项目"), {
      target: { value: otherProject!.id }
    });

    expect(confirmSpy).toHaveBeenCalledWith("更改项目将重新匹配 diff，已核对进度会重置。");
    expect(within(dialog).getByRole("region", { name: "解析与校验" })).toBeInTheDocument();
    expect(within(dialog).queryByText("已核对 1/1")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("已通过")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeEnabled();

    confirmSpy.mockRestore();
  });
});
