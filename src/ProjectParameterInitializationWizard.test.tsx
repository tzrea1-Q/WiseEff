import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ProjectParameterInitializationWizard } from "./ProjectParameterInitializationWizard";
import { initialState } from "./mockData";

describe("ProjectParameterInitializationWizard", () => {
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
    fireEvent.mouseDown(screen.getByRole("dialog"));
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
    const styles = readFileSync("src/styles.css", "utf8");
    const menuRule = styles.match(/\.parameters-column-filter__menu\s*\{[^}]*\}/)?.[0] ?? "";
    const menuHeadRule = styles.match(/\.parameters-column-filter__menu-head\s*\{[^}]*\}/)?.[0] ?? "";
    const optionLabelRule = styles.match(/\.parameters-column-filter__options label\s*\{[^}]*\}/)?.[0] ?? "";
    const optionLabelHoverRule = styles.match(/\.parameters-column-filter__options label:hover\s*\{[^}]*\}/)?.[0] ?? "";

    expect(menuRule).toMatch(/background:\s*#fff/);
    expect(menuRule).toMatch(/border-radius:\s*8px/);
    expect(menuRule).toMatch(/box-shadow:/);
    expect(menuHeadRule).toMatch(/padding-bottom:\s*8px/);
    expect(menuHeadRule).toMatch(/border-bottom:/);
    expect(optionLabelRule).toMatch(/display:\s*flex/);
    expect(optionLabelRule).toMatch(/border-radius:\s*6px/);
    expect(optionLabelRule).toMatch(/padding:\s*6px 8px/);
    expect(optionLabelHoverRule).toMatch(/background:\s*#f4f7ff/);
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

    const styles = readFileSync("src/styles.css", "utf8");
    const tableRule = styles.match(/\.project-init-table table\s*\{[^}]*\}/)?.[0] ?? "";
    const parameterCellRule = styles.match(/\.project-init-table__parameter\s*\{[^}]*\}/)?.[0] ?? "";
    const sourceCellRule = styles.match(/\.project-init-table__source\s*\{[^}]*\}/)?.[0] ?? "";

    expect(tableRule).toMatch(/table-layout:\s*fixed/);
    expect(tableRule).toMatch(/min-width:\s*860px/);
    expect(parameterCellRule).toMatch(/overflow:\s*hidden/);
    expect(parameterCellRule).toMatch(/text-overflow:\s*ellipsis/);
    expect(parameterCellRule).toMatch(/white-space:\s*nowrap/);
    expect(sourceCellRule).toMatch(/white-space:\s*nowrap/);
    expect(sourceCellRule).toMatch(/text-overflow:\s*ellipsis/);
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
    const styles = readFileSync("src/styles.css", "utf8");
    const wizardRule = styles.match(/\.project-init-wizard\s*\{[^}]*\}/)?.[0] ?? "";
    const mainRule = styles.match(/\.project-init-main\s*\{[^}]*\}/)?.[0] ?? "";
    const footerRule = styles.match(/\.project-init-footer\s*\{[^}]*\}/)?.[0] ?? "";
    const footerButtonRule = styles.match(/\.project-init-footer \.button\s*\{[^}]*\}/)?.[0] ?? "";
    const footerSubtleButtonRule = styles.match(/\.project-init-footer \.button\.subtle\s*\{[^}]*\}/)?.[0] ?? "";
    const footerPrimaryButtonRule = styles.match(/\.project-init-footer \.button\.primary\s*\{[^}]*\}/)?.[0] ?? "";

    expect(wizardRule).toMatch(/display:\s*flex/);
    expect(wizardRule).toMatch(/flex-direction:\s*column/);
    expect(wizardRule).toMatch(/overflow:\s*hidden/);
    expect(mainRule).toMatch(/flex:\s*1/);
    expect(mainRule).toMatch(/overflow:\s*auto/);
    expect(footerRule).toMatch(/background:\s*#fbfcff/);
    expect(footerRule).toMatch(/box-shadow:/);
    expect(footerButtonRule).toMatch(/display:\s*inline-flex/);
    expect(footerButtonRule).toMatch(/justify-content:\s*center/);
    expect(footerButtonRule).toMatch(/min-width:\s*96px/);
    expect(footerButtonRule).toMatch(/padding:\s*0 18px/);
    expect(footerButtonRule).toMatch(/border:\s*1px solid/);
    expect(footerButtonRule).toMatch(/border-radius:\s*8px/);
    expect(footerSubtleButtonRule).toMatch(/background:\s*#fff/);
    expect(footerPrimaryButtonRule).toMatch(/color:\s*#fff/);
    expect(footerPrimaryButtonRule).toMatch(/background:\s*var\(--app-primary\)/);
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

    const styles = readFileSync("src/styles.css", "utf8");
    const scopePanelRule = styles.match(/\.project-init-step-panel--scope\s*\{[^}]*\}/)?.[0] ?? "";

    expect(scopePanelRule).toMatch(/grid-template-columns:\s*1fr/);
    expect(scopePanelRule).not.toMatch(/minmax\(220px/);
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

    const styles = readFileSync("src/styles.css", "utf8");
    const sourcePanelRule = styles.match(/\.project-init-step-panel--source\s*\{[^}]*\}/)?.[0] ?? "";
    const sourceTableWrapRule = styles.match(/\.project-init-source-table-wrap\s*\{[^}]*\}/)?.[0] ?? "";

    expect(sourcePanelRule).toMatch(/grid-template-columns:\s*1fr/);
    expect(sourceTableWrapRule).toMatch(/max-height:\s*260px/);
    expect(sourceTableWrapRule).toMatch(/overflow:\s*auto/);
  });

  it("presents the project information step as a focused two-column form card", () => {
    render(<ProjectParameterInitializationWizard state={initialState} dispatch={vi.fn()} onClose={() => {}} />);

    const projectInfoRegion = screen.getByLabelText("项目信息");
    expect(projectInfoRegion).toHaveClass("project-init-form-card");
    expect(projectInfoRegion.closest(".project-init-step-panel")).toHaveClass("project-init-step-panel--project");
    expect(projectInfoRegion.querySelector(".project-init-form-card__fields")).toBeInTheDocument();

    const styles = readFileSync("src/styles.css", "utf8");
    const projectPanelRule = styles.match(/\.project-init-step-panel--project\s*\{[^}]*\}/)?.[0] ?? "";
    const formCardRule = styles.match(/\.project-init-form-card\s*\{[^}]*\}/)?.[0] ?? "";
    const formFieldsRule = styles.match(/\.project-init-form-card__fields\s*\{[^}]*\}/)?.[0] ?? "";

    expect(projectPanelRule).toMatch(/grid-template-columns:\s*minmax\(220px,\s*0\.72fr\) minmax\(0,\s*1fr\)/);
    expect(projectPanelRule).toMatch(/align-items:\s*start/);
    expect(projectPanelRule).toMatch(/min-height:\s*360px/);
    expect(formCardRule).toMatch(/padding:\s*22px/);
    expect(formCardRule).toMatch(/border:\s*1px solid/);
    expect(formCardRule).toMatch(/border-radius:\s*10px/);
    expect(formCardRule).toMatch(/box-shadow:/);
    expect(formFieldsRule).toMatch(/grid-template-columns:\s*1fr/);
  });
});
