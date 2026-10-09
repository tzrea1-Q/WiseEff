import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterImportWizard } from "./ParameterImportWizard";
import { fillPasteImportContent } from "./testHelpers";
import { initialState } from "@/mockData";
import * as dtsStructuredRuntime from "@/application/parameters/dtsStructuredRuntime";
import * as parameterTopologyResolve from "@/application/parameters/parameterTopologyResolve";
import * as parameterCatalogDtos from "@/infrastructure/http/parameterCatalogDtos";

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not render anything when closed", () => {
    renderWizard({ open: false });

    expect(screen.queryByRole("dialog", { name: "批量参数导入" })).not.toBeInTheDocument();
  });

  it("shows step 1 controls with the target project defaulted to the active project", () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
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

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
    fillPasteImportContent(dialog, '[{"name":"x"}]');

    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeEnabled();
  });

  it("closes when the close icon is clicked", () => {
    const { onClose } = renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes directly on Escape while the wizard is still clean", () => {
    const { onClose } = renderWizard();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "退出批量导入向导？" })).not.toBeInTheDocument();
  });

  it("guards Escape/close with a discard confirmation once parse progress exists", async () => {
    const { onClose } = renderWizard({}, { strict: true });

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
    fillPasteImportContent(
      dialog,
      JSON.stringify([
        {
          name: "guarded_param",
          module: "Guard Module",
          currentValue: "1",
          recommendedValue: "2",
          range: "0 - 10",
          unit: "unit",
          risk: "Low"
        }
      ])
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    // The stepper label 解析校验 is always visible on step 1, so wait for the
    // step-2 parse summary region — proof the async parse actually landed.
    await within(dialog).findByRole("region", { name: "解析与校验" });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    const confirmDialog = await screen.findByRole("dialog", { name: "退出批量导入向导？" });
    expect(confirmDialog).toHaveTextContent(/丢弃当前导入进度/);

    // 继续导入 keeps everything.
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "继续导入" }));
    expect(onClose).not.toHaveBeenCalled();

    // Explicit discard is the only way out.
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "退出批量导入向导？" })).getByRole("button", { name: "丢弃并退出" })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the project creation dialog and dispatches a local project in mock mode", () => {
    const { dispatch } = renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
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

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
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
    expect(within(summary).getByText("未匹配（不会应用）").nextElementSibling).toHaveTextContent("1");
    expect(within(summary).getByText("已有").nextElementSibling).toHaveTextContent("0");
    expect(within(summary).getByText("冲突").nextElementSibling).toHaveTextContent("0");
    expect(within(summary).getByText("待补全模块").nextElementSibling).toHaveTextContent("0");
    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeEnabled();
  });

  it("enables Step 3 next once every row has been approved", async () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
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

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
    fillPasteImportContent(dialog, "not,valid,parameter,rows");
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    await within(dialog).findByRole("region", { name: "解析与校验" });
    expect(within(dialog).getByRole("button", { name: "下一步" })).toBeDisabled();
  });

  it("shows the target project as read-only from step 3 onward", async () => {
    renderWizard();

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
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

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
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

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
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

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
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

  it("matches and reviews only canonical Bindings in API mode, never legacy shell rows", async () => {
    const mapBinding = vi.spyOn(parameterCatalogDtos, "parameterRecordFromBinding");
    vi.spyOn(dtsStructuredRuntime, "resolveDtsStructuredRepository").mockReturnValue({
      listConfigSets: vi.fn().mockResolvedValue([{ id: "cs-1", name: "default" }])
    } as never);
    vi.spyOn(parameterTopologyResolve, "resolveParameterTopologyRepository").mockReturnValue({
      getTopology: vi.fn().mockResolvedValue({ revisionId: "canonical-revision" }),
      listBindings: vi.fn().mockResolvedValue([
        { id: "canonical-binding", propertyKey: "iin_max", driverModule: "Canonical Driver", rawValue: "3000" }
      ])
    } as never);

    renderWizard({
      runtimeMode: "api",
      parameters: [{
        ...initialState.parameters[0],
        id: "legacy-shell-row",
        name: "legacy_only",
        module: "Legacy Shell Module",
        moduleId: undefined,
        modulePath: undefined,
        projectId: initialState.activeProjectId
      }]
    });
    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
    fillPasteImportContent(dialog, JSON.stringify([
      { name: "iin_max", module: "Canonical Driver", currentValue: "3100", risk: "Low" },
      { name: "legacy_only", module: "Legacy Shell Module", currentValue: "1", risk: "Low" }
    ]));
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    const summary = await within(dialog).findByRole("region", { name: "解析与校验" });
    expect(mapBinding).toHaveBeenCalledWith(initialState.activeProjectId, {
      id: "canonical-binding", propertyKey: "iin_max", driverModule: "Canonical Driver", rawValue: "3000"
    });
    expect(within(summary).getByText("总行数").nextElementSibling).toHaveTextContent("2");
    expect(within(summary).getByText("未匹配（不会应用）").nextElementSibling).toHaveTextContent("1");
    expect(within(summary).getByText("已有").nextElementSibling).toHaveTextContent("1");

    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    const canonicalRow = within(dialog).getByRole("region", { name: "导入行 iin_max" });
    const legacyRow = within(dialog).getByRole("region", { name: "导入行 legacy_only" });
    expect(within(canonicalRow).getByText("待核对")).toBeInTheDocument();
    expect(within(canonicalRow).getByRole("cell", { name: "3000" })).toBeInTheDocument();
    expect(within(legacyRow).getByText("未匹配")).toBeInTheDocument();
    expect(within(legacyRow).queryByRole("button", { name: "通过" })).not.toBeInTheDocument();

    fireEvent.click(within(canonicalRow).getByRole("button", { name: "编辑" }));
    const moduleSelect = within(canonicalRow).getByLabelText("编辑模块");
    expect(within(moduleSelect).getByRole("option", { name: "Canonical Driver" })).toBeInTheDocument();
    expect(within(moduleSelect).queryByRole("option", { name: "Legacy Shell Module" })).not.toBeInTheDocument();
    fireEvent.change(within(canonicalRow).getByLabelText("编辑当前值"), { target: { value: "3200" } });
    fireEvent.click(within(canonicalRow).getByRole("button", { name: "保存" }));
    expect(within(canonicalRow).getByText("待核对")).toBeInTheDocument();
    expect(within(canonicalRow).getByRole("cell", { name: "3000" })).toBeInTheDocument();
    expect(within(canonicalRow).getByRole("cell", { name: "3200" })).toBeInTheDocument();
  });

  it("rejects a pending project A read after switching to B and never matches A on review edits", async () => {
    const bindingA = { id: "binding-a", propertyKey: "a_only", driverModule: "Canonical Driver", rawValue: "111" };
    const bindingB = { id: "binding-b", propertyKey: "b_only", driverModule: "Canonical Driver", rawValue: "222" };
    let resolveProjectA!: (bindings: typeof bindingA[]) => void;
    const pendingProjectA = new Promise<typeof bindingA[]>((resolve) => { resolveProjectA = resolve; });
    const listBindings = vi.fn().mockImplementation((projectId: string) =>
      projectId === "project-a" ? pendingProjectA : Promise.resolve([bindingB])
    );
    vi.spyOn(dtsStructuredRuntime, "resolveDtsStructuredRepository").mockReturnValue({
      listConfigSets: vi.fn().mockResolvedValue([{ id: "cs-1", name: "default" }])
    } as never);
    vi.spyOn(parameterTopologyResolve, "resolveParameterTopologyRepository").mockReturnValue({
      getTopology: vi.fn().mockResolvedValue({ revisionId: "canonical-revision" }),
      listBindings
    } as never);
    renderWizard({
      runtimeMode: "api",
      activeProjectId: "project-a",
      projects: [
        { id: "project-a", name: "Project A", code: "A" },
        { id: "project-b", name: "Project B", code: "B" }
      ]
    });
    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
    fillPasteImportContent(dialog, JSON.stringify([
      { name: "b_only", module: "Canonical Driver", currentValue: "223", risk: "Low" }
    ]));
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    await waitFor(() => expect(listBindings).toHaveBeenCalledWith("project-a", "canonical-revision"));
    fireEvent.change(within(dialog).getByLabelText("目标项目"), { target: { value: "project-b" } });
    await act(async () => { resolveProjectA([bindingA]); });

    expect(within(dialog).queryByRole("region", { name: "解析与校验" })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("目标项目")).toHaveValue("project-b");
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    const summary = await within(dialog).findByRole("region", { name: "解析与校验" });
    expect(within(summary).getByText("已有").nextElementSibling).toHaveTextContent("1");
    expect(within(summary).getByText("未匹配（不会应用）").nextElementSibling).toHaveTextContent("0");
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    expect(within(dialog).getByLabelText("目标项目")).toHaveTextContent("Project B（B）");
    const rowB = within(dialog).getByRole("region", { name: "导入行 b_only" });
    expect(within(dialog).queryByRole("region", { name: "导入行 a_only" })).not.toBeInTheDocument();
    expect(within(rowB).getByRole("cell", { name: "222" })).toBeInTheDocument();
    fireEvent.click(within(rowB).getByRole("button", { name: "编辑" }));
    fireEvent.change(within(rowB).getByLabelText("编辑参数名"), { target: { value: "a_only" } });
    fireEvent.click(within(rowB).getByRole("button", { name: "保存" }));
    expect(within(rowB).getByText("未匹配")).toBeInTheDocument();
    expect(within(rowB).queryByRole("table", { name: "字段差异" })).not.toBeInTheDocument();
    expect(within(rowB).queryByRole("button", { name: "通过" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("cell", { name: "111" })).not.toBeInTheDocument();
  });

  it.each([
    { label: "the project has no config set", configSets: [] },
    { label: "the canonical Binding list is empty", configSets: [{ id: "cs-1", name: "default" }] }
  ])("does not fall back to legacy shell rows when $label", async ({ configSets }) => {
    vi.spyOn(dtsStructuredRuntime, "resolveDtsStructuredRepository").mockReturnValue({
      listConfigSets: vi.fn().mockResolvedValue(configSets)
    } as never);
    vi.spyOn(parameterTopologyResolve, "resolveParameterTopologyRepository").mockReturnValue({
      getTopology: vi.fn().mockResolvedValue({ revisionId: "canonical-revision" }),
      listBindings: vi.fn().mockResolvedValue([])
    } as never);

    renderWizard({ runtimeMode: "api" });
    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
    fillPasteImportContent(dialog, JSON.stringify([{
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      currentValue: "3200",
      risk: "High"
    }]));
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    const summary = await within(dialog).findByRole("region", { name: "解析与校验" });
    expect(within(summary).getByText("未匹配（不会应用）").nextElementSibling).toHaveTextContent("1");
    expect(within(summary).getByText("已有").nextElementSibling).toHaveTextContent("0");
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    expect(within(dialog).getByText("未匹配")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "通过" })).not.toBeInTheDocument();
  });

  it("stops matching when the published topology library cannot be loaded", async () => {
    vi.spyOn(dtsStructuredRuntime, "resolveDtsStructuredRepository").mockReturnValue({
      listConfigSets: vi.fn().mockResolvedValue([{ id: "cs-1", name: "default" }])
    } as never);
    vi.spyOn(parameterTopologyResolve, "resolveParameterTopologyRepository").mockReturnValue({
      getTopology: vi.fn().mockRejectedValue(new Error("topology unavailable")),
      listBindings: vi.fn()
    } as never);

    renderWizard({ runtimeMode: "api" });
    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
    fillPasteImportContent(
      dialog,
      JSON.stringify([
        {
          name: "iin_max",
          module: "Driver",
          currentValue: "3000",
          recommendedValue: "3000",
          range: "",
          unit: "",
          risk: "Low"
        }
      ])
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("无法加载当前项目的已发布参数");
    expect(within(dialog).queryByRole("button", { name: "预填并创建" })).not.toBeInTheDocument();
  });
});
