import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
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

  it("keeps actions aligned when no header copy is provided", () => {
    render(
      <WorkbenchLayout title="Actions only" actions={<button>Primary</button>}>
        <div>child</div>
      </WorkbenchLayout>
    );

    const actions = screen.getByRole("button", { name: "Primary" }).closest(".page-actions");
    const pageHeader = actions?.closest(".page-header");
    const styles = readFileSync("src/styles.css", "utf8");

    expect(pageHeader).toBeInTheDocument();
    expect(pageHeader?.children).toHaveLength(1);
    expect(actions).toBeInTheDocument();
    expect(styles).toMatch(/\.page-actions\s*{[^}]*margin-left:\s*auto;/s);
  });
});
