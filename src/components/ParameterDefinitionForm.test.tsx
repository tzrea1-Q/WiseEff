import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildParameterModuleTree } from "../parameterAdminLibrary";
import { initialState } from "../mockData";
import { ParameterDefinitionForm } from "./ParameterDefinitionForm";
import { modulePathSegments } from "./admin/moduleManagementTreeUtils";

afterEach(() => {
  cleanup();
});

const moduleNodes = buildParameterModuleTree([], initialState.configDraft.parameterModules);

function build(overrides: Partial<Parameters<typeof ParameterDefinitionForm>[0]> = {}) {
  return {
    parameter: initialState.configDraft.parameterLibrary[0],
    projects: initialState.configDraft.projects,
    moduleNodes,
    allParameters: initialState.configDraft.parameterLibrary,
    onMetadataChange: vi.fn(),
    onRecommendedValueChange: vi.fn(),
    ...overrides
  };
}

describe("ParameterDefinitionForm", () => {
  it("renders metadata fields and the risk picker", () => {
    render(<ParameterDefinitionForm {...build()} />);

    expect(screen.getByLabelText("参数名")).toBeInTheDocument();
    expect(screen.getByLabelText("模块")).toBeInTheDocument();
    expect(screen.getByLabelText(/推荐值/)).toBeInTheDocument();
    expect(screen.getByLabelText("单位")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "风险" })).toBeInTheDocument();
  });

  it("renders module tree select with the current module path", () => {
    const props = build();
    render(<ParameterDefinitionForm {...props} />);

    const moduleTrigger = screen.getByRole("button", { name: /模块/ });
    const selectedNode = moduleNodes.find((node) => node.name === props.parameter.module);
    expect(selectedNode).toBeDefined();
    expect(moduleTrigger).toHaveTextContent(modulePathSegments(selectedNode!, moduleNodes).join(" / "));
  });

  it("shows the recommended value global-effect hint", () => {
    render(<ParameterDefinitionForm {...build()} />);

    expect(screen.getByText(/对所有项目生效/)).toBeInTheDocument();
  });

  it("calls onRecommendedValueChange when the recommended value changes", () => {
    const props = build();
    render(<ParameterDefinitionForm {...props} />);

    fireEvent.change(screen.getByLabelText(/推荐值/), { target: { value: "9999" } });

    expect(props.onRecommendedValueChange).toHaveBeenCalledWith("9999");
  });

  it("shows an inline error for non snake_case names after the field is touched", () => {
    const props = build({ parameter: { ...initialState.configDraft.parameterLibrary[0], name: "BadName" } });
    render(<ParameterDefinitionForm {...props} />);

    fireEvent.blur(screen.getByLabelText("参数名"));
    expect(screen.getByText(/只允许小写字母、数字、下划线/)).toBeInTheDocument();
  });

  it("shows an inline error for duplicate names after the field is touched", () => {
    const params = initialState.configDraft.parameterLibrary;
    const props = build({ parameter: { ...params[0], name: params[1].name } });
    render(<ParameterDefinitionForm {...props} />);

    fireEvent.blur(screen.getByLabelText("参数名"));
    expect(screen.getByText(/已存在同名参数/)).toBeInTheDocument();
  });

  it("splits range into min and max inputs for scalar parameters", () => {
    render(<ParameterDefinitionForm {...build()} />);

    expect(screen.getByLabelText("范围最小值")).toBeInTheDocument();
    expect(screen.getByLabelText("范围最大值")).toBeInTheDocument();
  });

  it("calls onMetadataChange with moduleId when the module changes", () => {
    const props = build();
    render(<ParameterDefinitionForm {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "模块" }));
    fireEvent.click(screen.getByRole("button", { name: "Standby Power" }));

    expect(props.onMetadataChange).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "Standby Power",
        moduleId: expect.any(String),
        modulePath: expect.any(Array)
      })
    );
  });

  it("collapses expanded module tree nodes without closing the dropdown", () => {
    const nestedModules = [
      { name: "Power", description: "", scope: "" },
      { name: "Battery", description: "", scope: "", parent: "Power" },
      { name: "Battery Estimation", description: "", scope: "", parent: "Battery" },
      { name: "test", description: "", scope: "", parent: "Battery Estimation" }
    ];
    const props = build({ moduleNodes: buildParameterModuleTree([], nestedModules) });
    render(<ParameterDefinitionForm {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "模块" }));
    const tree = screen.getByRole("tree");
    const estimationOption = within(tree).getByRole("button", { name: "Battery Estimation" }).closest(".module-tree-option");
    const expandButton = estimationOption?.querySelector("button.module-tree-expand");
    expect(expandButton).toBeTruthy();

    fireEvent.click(expandButton!);
    expect(within(tree).getByRole("button", { name: "test" })).toBeInTheDocument();

    fireEvent.click(expandButton!);
    expect(within(tree).queryByRole("button", { name: "test" })).not.toBeInTheDocument();
    expect(tree).toBeInTheDocument();
  });

  it("uses a code editor and hides numeric range fields for complex parameters", () => {
    const complex = initialState.configDraft.parameterLibrary.find((parameter) => parameter.name === "battery_thermal_derate_curve");
    expect(complex).toBeDefined();

    render(<ParameterDefinitionForm {...build({ parameter: complex! })} />);

    expect(screen.getByLabelText("参数推荐配置")).toHaveClass("parameter-admin-code-editor");
    expect(screen.queryByLabelText("范围最小值")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("范围最大值")).not.toBeInTheDocument();
    expect(screen.getByLabelText("复杂参数摘要").querySelector(".parameter-draft-meta-pill")).toHaveTextContent("复杂配置");
  });
});
