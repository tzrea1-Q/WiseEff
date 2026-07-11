import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModuleDefinitionForm } from "./ModuleDefinitionForm";

describe("ModuleDefinitionForm", () => {
  it("does not show required errors before the field is touched", () => {
    render(
      <ModuleDefinitionForm
        existingNames={[]}
        module={{ name: "", description: "", scope: "" }}
        onChange={vi.fn()}
      />
    );

    expect(screen.queryByText("模块名称不能为空")).not.toBeInTheDocument();

    fireEvent.blur(screen.getByLabelText("模块名称"));
    expect(screen.getByText("模块名称不能为空")).toBeInTheDocument();
  });

  it("shows duplicate-name errors after the field is touched", () => {
    render(
      <ModuleDefinitionForm
        existingNames={["Battery Health"]}
        module={{ name: "Battery Health", description: "", scope: "" }}
        onChange={vi.fn()}
      />
    );

    expect(screen.queryByText("已存在同名模块")).not.toBeInTheDocument();

    fireEvent.blur(screen.getByLabelText("模块名称"));
    expect(screen.getByText("已存在同名模块")).toBeInTheDocument();
  });
});
