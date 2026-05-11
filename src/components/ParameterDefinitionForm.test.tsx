import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState } from "../mockData";
import { ParameterDefinitionForm } from "./ParameterDefinitionForm";

afterEach(() => {
  cleanup();
});

function build(overrides: Partial<Parameters<typeof ParameterDefinitionForm>[0]> = {}) {
  return {
    parameter: initialState.configDraft.parameterLibrary[0],
    projects: initialState.configDraft.projects,
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
    expect(screen.getByRole("radiogroup", { name: "重要性" })).toBeInTheDocument();
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

  it("shows an inline error for non snake_case names", () => {
    const props = build({ parameter: { ...initialState.configDraft.parameterLibrary[0], name: "BadName" } });
    render(<ParameterDefinitionForm {...props} />);

    expect(screen.getByText(/只允许小写字母、数字、下划线/)).toBeInTheDocument();
  });

  it("shows an inline error for duplicate names", () => {
    const params = initialState.configDraft.parameterLibrary;
    const props = build({ parameter: { ...params[0], name: params[1].name } });
    render(<ParameterDefinitionForm {...props} />);

    expect(screen.getByText(/已存在同名参数/)).toBeInTheDocument();
  });

  it("splits range into min and max inputs", () => {
    render(<ParameterDefinitionForm {...build()} />);

    expect(screen.getByLabelText("范围最小值")).toBeInTheDocument();
    expect(screen.getByLabelText("范围最大值")).toBeInTheDocument();
  });
});
