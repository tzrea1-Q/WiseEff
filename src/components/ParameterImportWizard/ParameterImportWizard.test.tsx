import { fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ParameterImportWizard } from "./ParameterImportWizard";
import { fillPasteImportContent } from "./testHelpers";
import { initialState } from "@/mockData";

function renderWizard(
  overrides: Partial<ComponentProps<typeof ParameterImportWizard>> = {},
  options: { strict?: boolean } = {}
) {
  const dispatch = vi.fn();
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  const wizard = (
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
  const utils = render(options.strict ? <StrictMode>{wizard}</StrictMode> : wizard);
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

    expect(within(dialog).getByRole("button", { name: "粘贴 JSON / CSV / DTS 内容" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("导入内容")).not.toBeInTheDocument();

    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeDisabled();
  });

  it("enables next once paste content is provided and a project is selected", () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fillPasteImportContent(dialog, '[{"name":"x"}]');

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

  it("parses a pasted JSON fixture and shows the Step 2 parse summary counts", async () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fillPasteImportContent(
      dialog,
      JSON.stringify([
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
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    const summary = await within(dialog).findByRole("region", { name: "解析与校验" });
    expect(within(summary).getByText("总行数").nextElementSibling).toHaveTextContent("1");
    expect(within(summary).getByText("新增候选").nextElementSibling).toHaveTextContent("1");
    expect(within(summary).getByText("已有").nextElementSibling).toHaveTextContent("0");
    expect(within(summary).getByText("冲突").nextElementSibling).toHaveTextContent("0");
    expect(within(summary).getByText("待补全模块").nextElementSibling).toHaveTextContent("0");
    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeEnabled();
  });

  it("enables Step 3 next once every row has been approved", async () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fillPasteImportContent(
      dialog,
      JSON.stringify([
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
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    await within(dialog).findByRole("region", { name: "解析与校验" });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    expect(within(dialog).getByRole("region", { name: "逐行核对" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "通过" }));

    expect(within(dialog).getByText("已核对 1/1")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeEnabled();
  });

  it("blocks advancing past Step 2 when parsing produces zero rows", async () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fillPasteImportContent(dialog, "not,valid,parameter,rows");
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    await within(dialog).findByRole("region", { name: "解析与校验" });
    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeDisabled();
  });

  it("shows the target project as read-only from step 3 onward", async () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fillPasteImportContent(
      dialog,
      JSON.stringify([
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
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    await within(dialog).findByRole("region", { name: "解析与校验" });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    expect(within(dialog).getByRole("region", { name: "逐行核对" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "目标项目" })).not.toBeInTheDocument();

    const activeProject = initialState.configDraft.projects.find((project) => project.id === initialState.activeProjectId);
    expect(activeProject).toBeDefined();
    expect(within(dialog).getByLabelText("目标项目")).toHaveTextContent(`${activeProject!.name}（${activeProject!.code}）`);
  });

  it("shows readable include rejection and server-parse hint for DTS sources", async () => {
    const parseDtsImport = vi.fn().mockRejectedValue(
      Object.assign(new Error("DTS /include/ 暂不支持，请提供展开后的文件。"), {
        details: { code: "dts-include-unsupported" }
      })
    );
    renderWizard({
      parameterActions: {
        getParameter: vi.fn(),
        submitChanges: vi.fn(),
        stashChanges: vi.fn(),
        discardDrafts: vi.fn(),
        withdrawSubmissionRound: vi.fn(),
        reviewChange: vi.fn(),
        createImportPreview: vi.fn(),
        applyImportBatch: vi.fn(),
        parseDtsImport,
        refresh: vi.fn()
      }
    });

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fillPasteImportContent(dialog, '/dts-v1/;\n/include/ "pin.dtsi"\n/ { board_id = <0>; };\n');
    expect(within(dialog).getByRole("status")).toHaveTextContent("将使用服务端解析");

    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("/include/");
    expect(parseDtsImport).toHaveBeenCalled();
  });

  it("passes skipped row reviewMetadata into createImportPreview", async () => {
    const createImportPreview = vi.fn().mockResolvedValue({
      id: "batch-1",
      projectId: initialState.activeProjectId,
      sourceName: "pasted-import.txt",
      status: "previewed",
      createdAt: "2026-05-25T08:00:00.000Z",
      summary: { added: 0, updated: 1, unchanged: 0, conflict: 0, highRisk: 1 },
      items: [
        {
          id: "item-1",
          name: "fast_charge_current_limit_ma",
          module: "Charging Policy",
          risk: "High",
          unit: "mA",
          range: "2500 - 4500",
          currentValue: "3200",
          recommendedValue: "3400",
          classification: "updated",
          riskFlag: true
        }
      ]
    });

    renderWizard({
      parameterActions: {
        getParameter: vi.fn(),
        submitChanges: vi.fn(),
        stashChanges: vi.fn(),
        discardDrafts: vi.fn(),
        withdrawSubmissionRound: vi.fn(),
        reviewChange: vi.fn(),
        createImportPreview,
        applyImportBatch: vi.fn(),
        parseDtsImport: vi.fn().mockResolvedValue({ format: "dts-full", rows: [] }),
        refresh: vi.fn()
      }
    });

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fillPasteImportContent(
      dialog,
      JSON.stringify([
        {
          name: "fast_charge_current_limit_ma",
          module: "Charging Policy",
          currentValue: "3200",
          recommendedValue: "3400",
          range: "2500 - 4500",
          unit: "mA",
          risk: "High"
        },
        {
          name: "skip_me_unique_param",
          module: "Wizard Test Module",
          currentValue: "3",
          recommendedValue: "4",
          range: "0 - 10",
          unit: "unit",
          risk: "Low"
        }
      ])
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    await within(dialog).findByRole("region", { name: "解析与校验" });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    await within(dialog).findByRole("region", { name: "逐行核对" });

    const keepCard = within(dialog).getByRole("region", { name: "导入行 fast_charge_current_limit_ma" });
    const skipCard = within(dialog).getByRole("region", { name: "导入行 skip_me_unique_param" });
    fireEvent.click(within(keepCard).getByRole("button", { name: "通过" }));
    fireEvent.click(within(skipCard).getByRole("button", { name: "跳过" }));
    fireEvent.change(within(skipCard).getByLabelText("跳过原因"), { target: { value: "不需要导入" } });
    fireEvent.click(within(skipCard).getByRole("button", { name: "确认跳过" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    await within(dialog).findByRole("region", { name: "批次预览" });
    expect(createImportPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewMetadata: {
          skippedRows: [
            expect.objectContaining({
              name: "skip_me_unique_param",
              module: "Wizard Test Module",
              reason: "不需要导入"
            })
          ],
          notes: "wizard skipped 1 row(s)"
        }
      })
    );
  });

  it("creates one preview when StrictMode replays the Step 4 effect", async () => {
    const createImportPreview = vi.fn().mockResolvedValue({
      id: "batch-strict",
      projectId: initialState.activeProjectId,
      sourceName: "pasted-import.txt",
      status: "previewed",
      createdAt: "2026-07-17T00:00:00.000Z",
      summary: { added: 0, updated: 1, unchanged: 0, conflict: 0, highRisk: 0 },
      items: [
        {
          id: "fast_charge_current_limit_ma",
          name: "fast_charge_current_limit_ma",
          module: "Charging Policy",
          risk: "High",
          unit: "mA",
          range: "2500 - 4500",
          currentValue: "3200",
          recommendedValue: "3400",
          classification: "updated",
          riskFlag: false
        }
      ]
    });
    renderWizard(
      {
        parameterActions: {
          getParameter: vi.fn(),
          submitChanges: vi.fn(),
          stashChanges: vi.fn(),
          discardDrafts: vi.fn(),
          withdrawSubmissionRound: vi.fn(),
          reviewChange: vi.fn(),
          createImportPreview,
          applyImportBatch: vi.fn(),
          parseDtsImport: vi.fn().mockResolvedValue({ format: "dts-full", rows: [] }),
          refresh: vi.fn()
        }
      },
      { strict: true }
    );

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
    fillPasteImportContent(
      dialog,
      JSON.stringify([
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
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    await within(dialog).findByRole("region", { name: "解析与校验" });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "通过" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    await within(dialog).findByRole("region", { name: "批次预览" });
    expect(createImportPreview).toHaveBeenCalledTimes(1);
  });
});
