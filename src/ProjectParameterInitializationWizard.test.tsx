import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SemanticInitializationSnapshotItem } from "@/domain/parameters/initializationTypes";
import { ProjectParameterInitializationWizard } from "./ProjectParameterInitializationWizard";
import { initialState } from "./mockData";
import { declarationsFor, readStylesheet } from "./test/cssAssertions";

describe("ProjectParameterInitializationWizard", () => {
  function canonicalSnapshot(
    overrides: Partial<SemanticInitializationSnapshotItem> = {}
  ): SemanticInitializationSnapshotItem {
    return {
      id: "snapshot-aurora-temperature",
      sourceProjectId: "aurora",
      sourceProjectParameterBindingId: "binding-aurora-temperature",
      sourceProjectValueId: "value-aurora-temperature",
      sourceRole: "primary",
      parameterSpecId: "definition-temperature",
      parameterSpecVersionId: "revision-definition-temperature",
      propertyKey: "battery_temp_target_c",
      moduleId: "battery-safety",
      risk: null,
      effectiveValue: 36.5,
      rawValue: "36.5",
      currentValueState: "pending_project_confirmation",
      alternativeSourceBindingIds: [],
      alternativeSourceValueIds: [],
      sourceConfigSetId: "config-aurora",
      sourceConfigRevisionId: "revision-aurora",
      sourceOccurrenceId: "occurrence-aurora",
      sourceName: "power/aurora.dts",
      sourceLocatorLabel: "temp-target @ /battery@0",
      sourceFormat: "dts",
      needsEffectiveValueConfirmation: false,
      ...overrides
    };
  }

  function fillProjectInfoAndContinue() {
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Zephyr" } });
    fireEvent.change(screen.getByLabelText("项目代号"), { target: { value: "ZEP" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  }

  function selectAuroraSourceAndContinue() {
    fireEvent.click(screen.getByLabelText(/^Aurora/));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  }

  function selectFirstCandidateAndContinue() {
    const table = screen.getByRole("table", { name: "参数库选择表" });
    const firstRowCheckbox = within(table).getAllByRole("checkbox")[1];
    fireEvent.click(firstRowCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  }

  it("shows one registration-style step page at a time", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    expect(screen.getByLabelText("项目名称")).toBeInTheDocument();
    expect(screen.getByLabelText("项目代号")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Aurora/)).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "参数库选择表" })).not.toBeInTheDocument();

    fillProjectInfoAndContinue();

    expect(screen.getByLabelText(/^Aurora/)).toBeInTheDocument();
    expect(screen.queryByLabelText("项目名称")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "参数库选择表" })).not.toBeInTheDocument();

    selectAuroraSourceAndContinue();

    expect(screen.getByRole("table", { name: "参数库选择表" })).toBeInTheDocument();
    expect(screen.queryByLabelText("项目名称")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Aurora/)).not.toBeInTheDocument();

    selectFirstCandidateAndContinue();

    expect(screen.getByRole("region", { name: "初始化快照预览" })).toBeInTheDocument();
    expect(screen.getByLabelText("备注")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "参数库选择表" })).not.toBeInTheDocument();
  });

  it("validates the current step before continuing", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText("请先填写项目名称和项目代号。")).toBeInTheDocument();
    expect(screen.getByLabelText("项目名称")).toBeInTheDocument();
  });

  it("requires a primary source when multiple source projects are selected", () => {
    const dispatch = vi.fn();
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={dispatch} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByLabelText(/^Aurora/));
    fireEvent.click(screen.getByLabelText(/^Nebula/));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText("请先选择主来源项目。")).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("allows creating a project when no source projects exist", () => {
    const dispatch = vi.fn();
    const emptyProjectState = {
      ...initialState,
      configDraft: {
        ...initialState.configDraft,
        projects: []
      }
    };

    render(<ProjectParameterInitializationWizard state={emptyProjectState} dispatch={dispatch} onClose={() => {}} />);

    fillProjectInfoAndContinue();

    expect(screen.getByText("当前平台尚无已有项目，可直接进入下一步创建空项目。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByRole("table", { name: "参数库选择表" })).toBeInTheDocument();
    expect(screen.getByText(/个参数库条目可选/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "提交初始化审阅" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SUBMIT_PARAMETER_INITIALIZATION",
        draft: expect.objectContaining({
          projectName: "Zephyr",
          projectCode: "ZEP",
          sourceProjectIds: [],
          primarySourceProjectId: "",
          selectedParameterIds: []
        })
      })
    );
  });

  it("allows starting from empty when source projects exist", () => {
    const dispatch = vi.fn();
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={dispatch} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByLabelText(/^从零开始/));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "提交初始化审阅" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SUBMIT_PARAMETER_INITIALIZATION",
        draft: expect.objectContaining({
          projectName: "Zephyr",
          projectCode: "ZEP",
          sourceProjectIds: [],
          primarySourceProjectId: "",
          selectedParameterIds: []
        })
      })
    );
  });

  it("requires choosing a source or starting from empty when projects exist", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText("请选择至少一个来源项目，或选择从零开始。")).toBeInTheDocument();
  });

  it("shows candidates when runtime parameters exist but configDraft parameterLibrary is empty", () => {
    const auroraRecord = initialState.parameters.find((parameter) => parameter.projectId === "aurora");
    expect(auroraRecord).toBeTruthy();

    const hydratedState = {
      ...initialState,
      configDraft: {
        ...initialState.configDraft,
        parameterLibrary: []
      },
      parameters: initialState.parameters
    };

    render(<ProjectParameterInitializationWizard state={hydratedState} dispatch={vi.fn()} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByLabelText(/^Aurora/));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText(/12 个参数库条目可选/)).toBeInTheDocument();
    expect(screen.getByText("battery_temp_target_c")).toBeInTheDocument();
  });

  it("previews canonical candidates and submits the exact source value snapshot", async () => {
    const snapshot = canonicalSnapshot();
    const onPreview = vi.fn().mockResolvedValue([snapshot]);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <ProjectParameterInitializationWizard
        state={initialState}
        dispatch={vi.fn()}
        onClose={onClose}
        onPreview={onPreview}
        onSubmit={onSubmit}
      />
    );

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByLabelText(/^Aurora/));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    await waitFor(() => {
      expect(onPreview).toHaveBeenCalledWith({
        projectId: "zep",
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: []
      });
    });
    expect(screen.getByRole("table", { name: "来源参数选择表" })).toBeInTheDocument();
    expect(screen.getByText("battery_temp_target_c")).toBeInTheDocument();
    expect(screen.getByText(/power\/aurora\.dts/)).toBeInTheDocument();
    expect(screen.getByText(/temp-target @ \/battery@0/)).toBeInTheDocument();
    expect(screen.getByText("未分类")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("选择 battery_temp_target_c"));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "提交初始化审阅" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SUBMIT_PARAMETER_INITIALIZATION",
        draft: expect.objectContaining({
          projectCode: "ZEP",
          selectedParameterIds: ["binding-aurora-temperature"]
        })
      }),
      [snapshot]
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps same-definition values independent across sources and labels their canonical files", async () => {
    const primary = canonicalSnapshot({
      alternativeSourceBindingIds: ["binding-nebula-temperature"],
      alternativeSourceValueIds: ["value-nebula-temperature"]
    });
    const supplement = canonicalSnapshot({
      id: "snapshot-nebula-temperature",
      sourceProjectId: "nebula",
      sourceProjectParameterBindingId: "binding-nebula-temperature",
      sourceProjectValueId: "value-nebula-temperature",
      sourceRole: "supplement",
      rawValue: "48",
      sourceConfigSetId: "config-nebula",
      sourceConfigRevisionId: "revision-nebula",
      sourceOccurrenceId: "occurrence-nebula",
      sourceName: "power/nebula.dts",
      sourceLocatorLabel: "temp-target @ /battery@1",
      alternativeSourceBindingIds: ["binding-aurora-temperature"],
      alternativeSourceValueIds: ["value-aurora-temperature"]
    });
    const onPreview = vi.fn().mockResolvedValue([primary, supplement]);

    render(
      <ProjectParameterInitializationWizard
        state={initialState}
        dispatch={vi.fn()}
        onClose={vi.fn()}
        onPreview={onPreview}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByLabelText(/^Aurora/));
    fireEvent.click(screen.getByLabelText(/^Nebula/));
    fireEvent.click(screen.getByLabelText("设 Aurora 量产平台 为主来源"));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    await waitFor(() => expect(screen.getAllByText("battery_temp_target_c")).toHaveLength(2));
    expect(screen.getAllByText(/多来源同定义：1 个独立来源值待确认；来源配置集保持独立。/)).toHaveLength(2);
    expect(screen.getByText(/power\/aurora\.dts/)).toBeInTheDocument();
    expect(screen.getByText(/power\/nebula\.dts/)).toBeInTheDocument();
    expect(screen.getByText(/temp-target @ \/battery@1/)).toBeInTheDocument();
  });

  it("does not fall back to the legacy parameter library when canonical preview is empty", async () => {
    const onPreview = vi.fn().mockResolvedValue([]);

    render(
      <ProjectParameterInitializationWizard
        state={initialState}
        dispatch={vi.fn()}
        onClose={vi.fn()}
        onPreview={onPreview}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByLabelText(/^Aurora/));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    await waitFor(() => expect(screen.getByText("当前来源没有可用的来源参数。")).toBeInTheDocument());
    expect(screen.queryByText("battery_temp_target_c")).not.toBeInTheDocument();
    expect(screen.queryByText("参数库暂不可用。")).not.toBeInTheDocument();
  });

  it("rejects a JSON canonical candidate without an exact config revision", async () => {
    const onPreview = vi.fn().mockResolvedValue([
      canonicalSnapshot({
        sourceFormat: "json",
        sourceConfigRevisionId: undefined,
        sourceName: "settings.json",
        sourceLocatorLabel: "/battery/temp-target"
      })
    ]);

    render(
      <ProjectParameterInitializationWizard
        state={initialState}
        dispatch={vi.fn()}
        onClose={vi.fn()}
        onPreview={onPreview}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByLabelText(/^Aurora/));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    await waitFor(() => {
      expect(screen.getByText("来源快照缺少精确来源固定、文件或定位信息，已停止加载。")).toBeInTheDocument();
    });
    expect(screen.queryByRole("table", { name: "来源参数选择表" })).not.toBeInTheDocument();
  });

  it("locks source choices while canonical preview is pending", async () => {
    const snapshot = canonicalSnapshot();
    let resolvePreview: ((snapshots: SemanticInitializationSnapshotItem[]) => void) | undefined;
    const onPreview = vi.fn(() => new Promise<SemanticInitializationSnapshotItem[]>((resolve) => {
      resolvePreview = resolve;
    }));

    render(
      <ProjectParameterInitializationWizard
        state={initialState}
        dispatch={vi.fn()}
        onClose={vi.fn()}
        onPreview={onPreview}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fillProjectInfoAndContinue();
    const auroraSource = screen.getByLabelText(/^Aurora/);
    const nebulaSource = screen.getByLabelText(/^Nebula/);
    fireEvent.click(auroraSource);
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    await waitFor(() => {
      expect(onPreview).toHaveBeenCalledWith({
        projectId: "zep",
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: []
      });
      expect(screen.getByRole("button", { name: "加载中…" })).toBeDisabled();
    });

    const search = screen.getByLabelText("搜索来源项目");
    const primarySource = screen.getByLabelText("设 Aurora 量产平台 为主来源");
    expect(auroraSource).toBeDisabled();
    expect(nebulaSource).toBeDisabled();
    expect(primarySource).toBeDisabled();
    expect(search).toBeDisabled();

    fireEvent.click(nebulaSource);
    fireEvent.click(primarySource);
    fireEvent.change(search, { target: { value: "Nebula" } });
    expect(auroraSource).toBeChecked();
    expect(nebulaSource).not.toBeChecked();
    expect(primarySource).toBeChecked();
    expect(search).toHaveValue("");
    expect(onPreview).toHaveBeenCalledTimes(1);

    resolvePreview?.([snapshot]);
    await waitFor(() => {
      expect(screen.getByRole("table", { name: "来源参数选择表" })).toBeInTheDocument();
    });
  });

  it("previews an empty project with no snapshots and submits an empty selection", async () => {
    const emptyProjectState = {
      ...initialState,
      configDraft: {
        ...initialState.configDraft,
        projects: []
      }
    };
    const onPreview = vi.fn().mockResolvedValue([]);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <ProjectParameterInitializationWizard
        state={emptyProjectState}
        dispatch={vi.fn()}
        onClose={onClose}
        onPreview={onPreview}
        onSubmit={onSubmit}
      />
    );

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    await waitFor(() => {
      expect(onPreview).toHaveBeenCalledWith({
        projectId: "zep",
        primarySourceProjectId: null,
        supplementSourceProjectIds: []
      });
    });
    expect(screen.getByText("当前来源没有可用的来源参数。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "提交初始化审阅" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.anything(), []));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the wizard open and disables controls while API submit is pending", async () => {
    const snapshot = canonicalSnapshot();
    const onPreview = vi.fn().mockResolvedValue([snapshot]);
    let resolveSubmit: (() => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    }));
    const onClose = vi.fn();

    render(
      <ProjectParameterInitializationWizard
        state={initialState}
        dispatch={vi.fn()}
        onClose={onClose}
        onPreview={onPreview}
        onSubmit={onSubmit}
      />
    );

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByLabelText(/^Aurora/));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    await waitFor(() => expect(screen.getByLabelText("选择 battery_temp_target_c")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("选择 battery_temp_target_c"));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "提交初始化审阅" }));

    expect(screen.getByRole("button", { name: "提交中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上一步" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    resolveSubmit?.();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("submits selected parameters for initialization review", () => {
    const dispatch = vi.fn();
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={dispatch} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByLabelText(/^Aurora/));
    fireEvent.click(screen.getByLabelText("设 Aurora 量产平台 为主来源"));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选模块" }));
    fireEvent.click(within(screen.getByRole("group", { name: "模块筛选" })).getByLabelText(/Battery Safety/));
    fireEvent.click(screen.getByRole("button", { name: "筛选风险" }));
    fireEvent.click(within(screen.getByRole("group", { name: "风险筛选" })).getByLabelText("中"));

    fireEvent.click(screen.getByLabelText("选择 battery_temp_target_c"));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "提交初始化审阅" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SUBMIT_PARAMETER_INITIALIZATION",
        draft: expect.objectContaining({
          projectName: "Zephyr",
          projectCode: "ZEP",
          primarySourceProjectId: "aurora",
          selectedParameterIds: expect.any(Array)
        })
      })
    );
  });

  it("preserves selected parameters that are hidden by later filters", () => {
    const dispatch = vi.fn();
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={dispatch} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByLabelText(/^Aurora/));
    fireEvent.click(screen.getByLabelText("设 Aurora 量产平台 为主来源"));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    fireEvent.click(screen.getByLabelText("选择 battery_temp_target_c"));
    fireEvent.click(screen.getByRole("button", { name: "筛选模块" }));
    fireEvent.click(within(screen.getByRole("group", { name: "模块筛选" })).getByLabelText(/Charging Policy/));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "提交初始化审阅" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SUBMIT_PARAMETER_INITIALIZATION",
        draft: expect.objectContaining({
          selectedParameterIds: expect.arrayContaining(["battery-temp-target"])
        })
      })
    );
  });

  it("closes the wizard from Escape and backdrop clicks", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={onClose} />
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={onClose} />);
    // The shared modal contract dismisses only when press and release both land on the backdrop.
    const backdrop = screen.getByRole("dialog").parentElement!;
    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("guards Escape with a discard confirmation once any field is filled", async () => {
    const onClose = vi.fn();
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/项目名称/), { target: { value: "Halo 台架" } });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    const confirmDialog = screen.getByRole("dialog", { name: "放弃项目初始化？" });
    expect(confirmDialog).toHaveTextContent(/尚未提交，关闭向导后将全部丢失/);

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "继续填写" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/项目名称/)).toHaveValue("Halo 台架");

    // Backdrop dismissal is a paired pointer-down/up on the ModalDialog backdrop
    // (a mousedown on the card itself must not trigger the guard).
    const backdrop = document.querySelector(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "放弃项目初始化？" })).getByRole("button", { name: "放弃并关闭" })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("integrates module and risk filters into the parameter table headers", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    selectAuroraSourceAndContinue();

    expect(screen.queryByText("不选择模块时默认包含全部模块。")).not.toBeInTheDocument();
    expect(screen.queryByText("不选择风险等级时默认包含全部等级。")).not.toBeInTheDocument();

    const table = screen.getByRole("table", { name: "参数库选择表" });
    const moduleHeader = within(table).getByRole("columnheader", { name: /模块/ });
    const riskHeader = within(table).getByRole("columnheader", { name: /风险/ });
    expect(within(moduleHeader).getByRole("button", { name: "筛选模块" })).toHaveAttribute("aria-expanded", "false");
    expect(within(riskHeader).getByRole("button", { name: "筛选风险" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(within(moduleHeader).getByRole("button", { name: "筛选模块" }));
    const moduleMenu = screen.getByRole("group", { name: "模块筛选" });
    expect(within(moduleMenu).getByLabelText("Battery Safety")).toBeInTheDocument();
    fireEvent.click(within(moduleMenu).getByLabelText("Battery Safety"));

    expect(within(table).getByText("battery_temp_target_c")).toBeInTheDocument();
    expect(within(table).queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();
    expect(within(moduleHeader).getByRole("button", { name: "筛选模块" })).toHaveClass("active");

    fireEvent.click(within(riskHeader).getByRole("button", { name: "筛选风险" }));
    const riskMenu = screen.getByRole("group", { name: "风险筛选" });
    fireEvent.click(within(riskMenu).getByLabelText("高"));

    expect(within(table).queryByText("battery_temp_target_c")).not.toBeInTheDocument();
    expect(within(table).getByText(/当前筛选条件下没有匹配参数/)).toBeInTheDocument();
  });

  it("supports header filters on every initialization candidate data column", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    selectAuroraSourceAndContinue();

    const table = screen.getByRole("table", { name: "参数库选择表" });
    const checks: Array<[string, string, string]> = [
      ["参数", "筛选参数", "battery_temp_target_c"],
      ["模块", "筛选模块", "Battery Safety"],
      ["风险", "筛选风险", "中"],
      ["推荐值", "筛选推荐值", "35"],
      ["来源", "筛选来源", "Aurora 量产平台 (主来源)"]
    ];

    for (const [headerName, buttonName, optionName] of checks) {
      const header = within(table).getByRole("columnheader", { name: new RegExp(headerName) });
      fireEvent.click(within(header).getByRole("button", { name: buttonName }));
      expect(within(header).getByRole("checkbox", { name: optionName })).toBeInTheDocument();
      fireEvent.click(within(header).getByRole("button", { name: buttonName }));
    }

    const valueHeader = within(table).getByRole("columnheader", { name: /推荐值/ });
    fireEvent.click(within(valueHeader).getByRole("button", { name: "筛选推荐值" }));
    fireEvent.click(within(valueHeader).getByRole("checkbox", { name: "35" }));

    expect(within(table).getByText("battery_temp_target_c")).toBeInTheDocument();
    expect(within(table).queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();
  });

  it("collapses an open table filter when clicking outside it", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    selectAuroraSourceAndContinue();

    fireEvent.click(screen.getByRole("button", { name: "筛选风险" }));
    const riskMenu = screen.getByRole("group", { name: "风险筛选" });
    expect(riskMenu).toBeInTheDocument();

    fireEvent.mouseDown(within(riskMenu).getByLabelText("中"));
    expect(screen.getByRole("group", { name: "风险筛选" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText(/12 个参数库条目可选/));
    expect(screen.queryByRole("group", { name: "风险筛选" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选风险" })).toHaveAttribute("aria-expanded", "false");
  });

  it("styles table filter menus as compact floating panels", () => {
    const styles = readStylesheet("src/styles.css");
    const menuRule = declarationsFor(styles, ".parameters-column-filter__menu");
    const menuHeadRule = declarationsFor(styles, ".parameters-column-filter__menu-head");
    const optionLabelRule = declarationsFor(styles, ".parameters-column-filter__options label");
    const optionLabelHoverRule = declarationsFor(styles, ".parameters-column-filter__options label:hover");

    expect(menuRule.background).toContain("var(--surface)");
    expect(menuRule["border-radius"]).toBe("var(--radius-md)");
    expect(menuRule["box-shadow"]).toBeTruthy();
    expect(menuHeadRule["padding-bottom"]).toBe("var(--space-2)");
    expect(menuHeadRule["border-bottom"]).toBeTruthy();
    expect(optionLabelRule.display).toBe("flex");
    expect(optionLabelRule["border-radius"]).toBe("var(--radius-sm)");
    expect(optionLabelRule.padding).toBe("6px var(--space-2)");
    expect(optionLabelHoverRule.background).toBe("#f4f7ff");
  });

  it("keeps the initialization parameter table columns readable", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    selectAuroraSourceAndContinue();

    const table = screen.getByRole("table", { name: "参数库选择表" });
    const columns = table.querySelectorAll("colgroup col");

    expect(columns).toHaveLength(7);
    expect(columns[0]).toHaveClass("project-init-col-select");
    expect(columns[1]).toHaveClass("project-init-col-parameter");
    expect(columns[2]).toHaveClass("project-init-col-module");
    expect(columns[3]).toHaveClass("project-init-col-risk");
    expect(columns[4]).toHaveClass("project-init-col-value");
    expect(columns[5]).toHaveClass("project-init-col-source");
    expect(columns[6]).toHaveClass("project-init-col-detail");

    const firstParameterCell = within(table).getByText("fast_charge_current_limit_ma").closest("td");
    const firstParameterRow = firstParameterCell?.closest("tr");
    expect(firstParameterRow).not.toBeNull();
    const firstSourceCell = within(firstParameterRow as HTMLElement).getByText(/Aurora 量产平台/).closest("td");
    expect(firstParameterCell).toHaveClass("project-init-table__parameter");
    expect(firstSourceCell).toHaveClass("project-init-table__source");

    const styles = readStylesheet("src/styles.css");
    const tableRule = declarationsFor(styles, ".project-init-table table");
    const parameterCellRule = declarationsFor(styles, ".project-init-table__parameter");
    const sourceCellRule = declarationsFor(styles, ".project-init-table__source");

    expect(tableRule["table-layout"]).toBe("fixed");
    expect(tableRule["min-width"]).toBe("860px");
    expect(parameterCellRule.overflow).toBe("hidden");
    expect(parameterCellRule["text-overflow"]).toBe("ellipsis");
    expect(parameterCellRule["white-space"]).toBe("nowrap");
    expect(sourceCellRule["white-space"]).toBe("nowrap");
    expect(sourceCellRule["text-overflow"]).toBe("ellipsis");
  });

  it("shows parameter details from a candidate row", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    selectAuroraSourceAndContinue();

    const table = screen.getByRole("table", { name: "参数库选择表" });
    const columns = table.querySelectorAll("colgroup col");
    expect(columns).toHaveLength(7);
    expect(columns[6]).toHaveClass("project-init-col-detail");

    fireEvent.click(within(table).getByRole("button", { name: "查看 fast_charge_current_limit_ma 详情" }));

    const detailPanel = screen.getByRole("complementary", { name: "参数详情" });
    expect(detailPanel).toHaveTextContent("fast_charge_current_limit_ma");
    expect(detailPanel).toHaveTextContent("Charging Policy");
    expect(detailPanel).toHaveTextContent("高");
    expect(detailPanel).toHaveTextContent("3200 mA");
    expect(detailPanel).toHaveTextContent("2500 - 4500 mA");
    expect(detailPanel).toHaveTextContent("Aurora 量产平台");
    expect(detailPanel).toHaveTextContent("限制快充阶段的最大充电电流。");
    expect(detailPanel).toHaveTextContent("YAML: power.charge.fast_current_limit_ma: number");

    fireEvent.click(screen.getByRole("button", { name: "关闭参数详情" }));
    expect(screen.queryByRole("complementary", { name: "参数详情" })).not.toBeInTheDocument();
  });

  it("keeps footer actions in a stable bottom action bar", () => {
    // Footer buttons consume the shared `.button` base contract (FA-10); the
    // scope only keeps the stable CTA min-width.
    const styles = readStylesheet("src/styles.css");
    const wizardRule = declarationsFor(styles, ".project-init-wizard");
    const mainRule = declarationsFor(styles, ".project-init-main");
    const footerRule = declarationsFor(styles, ".project-init-footer");
    const footerButtonRule = declarationsFor(styles, ".project-init-footer .button");
    const baseButtonRule = declarationsFor(styles, ".button");
    const baseSubtleRule = declarationsFor(styles, ".button.subtle");
    const basePrimaryRule = declarationsFor(styles, ".button.primary");

    expect(wizardRule.display).toBe("flex");
    expect(wizardRule["flex-direction"]).toBe("column");
    expect(wizardRule.overflow).toBe("hidden");
    expect(mainRule.flex).toContain("1");
    expect(mainRule.overflow).toBe("auto");
    expect(footerRule.background).toBe("#fbfcff");
    expect(footerRule["box-shadow"]).toBeTruthy();
    expect(footerButtonRule["min-width"]).toBe("96px");
    expect(baseButtonRule.display).toBe("inline-flex");
    expect(baseButtonRule["justify-content"]).toBe("center");
    expect(baseButtonRule.border).toContain("1px solid");
    expect(baseButtonRule["border-radius"]).toBe("var(--radius-md)");
    expect(baseSubtleRule.background).toBe("var(--surface)");
    expect(basePrimaryRule.color).toBe("var(--primary-foreground)");
    expect(basePrimaryRule.background).toBe("var(--accent)");
  });

  it("allows selecting parameters from the library when starting from empty", () => {
    const dispatch = vi.fn();
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={dispatch} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    fireEvent.click(screen.getByLabelText(/^从零开始/));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText(/个参数库条目可选/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("选择 battery_temp_target_c"));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "提交初始化审阅" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SUBMIT_PARAMETER_INITIALIZATION",
        draft: expect.objectContaining({
          sourceProjectIds: [],
          selectedParameterIds: expect.arrayContaining(["battery-temp-target"])
        })
      })
    );
  });

  it("presents the scope step as a full-width stacked layout for the parameter table", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    fillProjectInfoAndContinue();
    selectAuroraSourceAndContinue();

    const scopeStepPanel = screen.getByLabelText("参数范围").closest(".project-init-step-panel");
    expect(scopeStepPanel).toHaveClass("project-init-step-panel--scope");
    expect(scopeStepPanel?.querySelector(".project-init-step-copy:not(.project-init-step-copy--scope)")).toBeNull();
    expect(screen.getByRole("heading", { name: "从参数库选择项目参数" }).closest(".project-init-step-copy--scope")).toBeTruthy();
    expect(screen.getByText(/12 个参数库条目可选/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "参数库选择表" })).toBeInTheDocument();

    const styles = readStylesheet("src/styles.css");
    const scopePanelRule = declarationsFor(styles, ".project-init-step-panel--scope");

    expect(scopePanelRule["grid-template-columns"]).toBe("1fr");
  });

  it("filters source projects with search when many projects exist", () => {
    const manyProjectsState = {
      ...initialState,
      configDraft: {
        ...initialState.configDraft,
        projects: [
          ...initialState.configDraft.projects,
          ...Array.from({ length: 18 }, (_, index) => ({
            id: `bench-project-${index}`,
            name: `Bench Project ${index}`,
            code: `BP-${index}`
          }))
        ]
      }
    };

    render(<ProjectParameterInitializationWizard state={manyProjectsState} dispatch={vi.fn()} onClose={() => {}} />);

    fillProjectInfoAndContinue();

    expect(screen.getByText(/共 21 个项目/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索来源项目" }), { target: { value: "Bench Project 17" } });
    expect(screen.getByText(/显示 1 \/ 21 个项目/)).toBeInTheDocument();
    expect(screen.getByLabelText("Bench Project 17")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Aurora/)).not.toBeInTheDocument();
  });

  it("presents the source step as a searchable compact project table", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    fillProjectInfoAndContinue();

    const sourceStepPanel = screen.getByLabelText("来源项目").closest(".project-init-step-panel");
    expect(sourceStepPanel).toHaveClass("project-init-step-panel--source");
    expect(sourceStepPanel?.querySelector(".project-init-step-copy:not(.project-init-step-copy--source)")).toBeNull();
    expect(screen.getByRole("heading", { name: "选择要继承的项目" }).closest(".project-init-step-copy--source")).toBeTruthy();
    expect(screen.getByRole("table", { name: "可选来源项目" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索来源项目" })).toBeInTheDocument();

    const styles = readStylesheet("src/styles.css");
    const sourcePanelRule = declarationsFor(styles, ".project-init-step-panel--source");
    const sourceTableWrapRule = declarationsFor(styles, ".project-init-source-table-wrap");

    expect(sourcePanelRule["grid-template-columns"]).toBe("1fr");
    expect(sourceTableWrapRule["max-height"]).toBe("260px");
    expect(sourceTableWrapRule.overflow).toBe("auto");
  });

  it("presents the project information step as a focused two-column form card", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    const projectInfoRegion = screen.getByLabelText("项目信息");
    expect(projectInfoRegion).toHaveClass("project-init-form-card");
    expect(projectInfoRegion.closest(".project-init-step-panel")).toHaveClass("project-init-step-panel--project");
    expect(projectInfoRegion.querySelector(".project-init-form-card__fields")).toBeInTheDocument();

    const styles = readStylesheet("src/styles.css");
    const projectPanelRule = declarationsFor(styles, ".project-init-step-panel--project");
    const formCardRule = declarationsFor(styles, ".project-init-form-card");
    const formFieldsRule = declarationsFor(styles, ".project-init-form-card__fields");

    expect(projectPanelRule["grid-template-columns"]).toBe("minmax(220px, 0.72fr) minmax(0, 1fr)");
    expect(projectPanelRule["align-items"]).toBe("start");
    expect(projectPanelRule["min-height"]).toBe("360px");
    expect(formCardRule.padding).toBe("22px");
    expect(formCardRule.border).toContain("1px solid");
    expect(formCardRule["border-radius"]).toBe("10px");
    expect(formCardRule["box-shadow"]).toBeTruthy();
    expect(formFieldsRule["grid-template-columns"]).toBe("1fr");
  });
});
