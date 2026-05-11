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

    expect(screen.getByLabelText("项目参数用户工作台")).toHaveClass("workbench-page");
    expect(screen.queryByRole("heading", { level: 1, name: "项目参数用户工作台" })).not.toBeInTheDocument();
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("renders header slot content with actions", () => {
    render(
      <WorkbenchLayout
        title="项目参数用户工作台"
        header={<nav aria-label="面包屑">参数管理 › 项目参数工作台</nav>}
        actions={<button>主按钮</button>}
      >
        <div>child</div>
      </WorkbenchLayout>
    );

    expect(screen.getByRole("navigation", { name: "面包屑" })).toHaveTextContent("参数管理 › 项目参数工作台");
    expect(screen.getByRole("button", { name: "主按钮" })).toBeInTheDocument();
  });
});
