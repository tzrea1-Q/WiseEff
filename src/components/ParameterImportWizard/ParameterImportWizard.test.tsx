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
});
