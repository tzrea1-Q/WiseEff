import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkbenchLayout } from "./workbenchUi";

describe("WorkbenchLayout", () => {
  it("uses the title as an accessible label without rendering a duplicate h1", () => {
    render(
      <WorkbenchLayout title="项目参数用户工作台">
        <div>child</div>
      </WorkbenchLayout>
    );

    expect(screen.getByRole("region", { name: "项目参数用户工作台" })).toHaveClass("workbench-page");
    expect(screen.queryByRole("heading", { level: 1, name: "项目参数用户工作台" })).not.toBeInTheDocument();
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("renders children only, without the retired workspace header layer", () => {
    render(
      <WorkbenchLayout title="项目参数用户工作台">
        <div>child</div>
      </WorkbenchLayout>
    );

    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "项目参数用户工作台" }).firstElementChild).toHaveClass("workbench-grid");
  });
});
