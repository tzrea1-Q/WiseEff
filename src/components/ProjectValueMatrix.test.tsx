import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState } from "../mockData";
import { ProjectValueMatrix } from "./ProjectValueMatrix";

afterEach(() => {
  cleanup();
});

function build(overrides: Partial<Parameters<typeof ProjectValueMatrix>[0]> = {}) {
  return {
    parameter: initialState.configDraft.parameterLibrary[0],
    projects: initialState.configDraft.projects,
    onValueChange: vi.fn(),
    ...overrides
  };
}

describe("ProjectValueMatrix", () => {
  it("renders one row per project with current value inputs and read-only updated time", () => {
    render(<ProjectValueMatrix {...build()} />);

    for (const project of initialState.configDraft.projects) {
      expect(screen.getByLabelText(`${project.code} 当前值`)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/更新时间/)).toBeNull();
  });

  it("shows the unit next to every current value", () => {
    render(<ProjectValueMatrix {...build({ parameter: { ...initialState.configDraft.parameterLibrary[0], unit: "mA" } })} />);

    expect(screen.getAllByText("mA")).toHaveLength(initialState.configDraft.projects.length);
  });

  it("renders complex parameters with multiline editors and recommended config blocks", () => {
    const complex = initialState.configDraft.parameterLibrary.find((parameter) => parameter.name === "battery_thermal_derate_curve");
    expect(complex).toBeDefined();

    render(<ProjectValueMatrix {...build({ parameter: complex! })} />);

    expect(screen.queryByText("偏差")).not.toBeInTheDocument();
    expect(screen.getByLabelText(`${initialState.configDraft.projects[0].code} 当前配置`)).toHaveClass("parameter-admin-code-editor");
    expect(screen.getAllByText("推荐配置").length).toBeGreaterThan(0);
  });

  it("marks out-of-range values invalid", () => {
    const parameter = {
      ...initialState.configDraft.parameterLibrary[0],
      range: "2500 - 4500",
      values: Object.fromEntries(
        initialState.configDraft.projects.map((project, index) => [
          project.id,
          {
            currentValue: index === 0 ? "4800" : "3000",
            recommendedValue: "3200",
            updatedAt: "2026-05-10T00:00:00.000Z"
          }
        ])
      ) as typeof initialState.configDraft.parameterLibrary[0]["values"]
    };

    render(<ProjectValueMatrix {...build({ parameter })} />);

    expect(screen.getByDisplayValue("4800")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/超过上限 4500|越界/)).toBeInTheDocument();
  });

  it("writes currentValue and updatedAt when a value changes", () => {
    const props = build();
    render(<ProjectValueMatrix {...props} />);

    fireEvent.change(screen.getByLabelText(`${initialState.configDraft.projects[0].code} 当前值`), { target: { value: "3100" } });

    expect(props.onValueChange).toHaveBeenCalledWith(
      initialState.configDraft.projects[0].id,
      expect.objectContaining({ currentValue: "3100", updatedAt: expect.any(String) })
    );
  });

  it("classifies deviation percentages", () => {
    const parameter = {
      ...initialState.configDraft.parameterLibrary[0],
      range: "0 - 10000",
      values: Object.fromEntries(
        initialState.configDraft.projects.map((project, index) => [
          project.id,
          {
            currentValue: String([3400, 4100, 5000][index]),
            recommendedValue: "3200",
            updatedAt: "2026-05-10T00:00:00.000Z"
          }
        ])
      ) as typeof initialState.configDraft.parameterLibrary[0]["values"]
    };

    render(<ProjectValueMatrix {...build({ parameter })} />);

    expect(screen.getByText(/\+6\.3%/)).toHaveClass("deviation-ok");
    expect(screen.getByText(/\+28\.1%/)).toHaveClass("deviation-danger");
  });
});
