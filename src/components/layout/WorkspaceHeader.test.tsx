import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceHeader } from "./WorkspaceHeader";

describe("WorkspaceHeader", () => {
  it("renders page context, actions, and status without creating a duplicate page heading", () => {
    render(
      <WorkspaceHeader
        ariaLabel="参数工作区上下文"
        breadcrumb={[
          { label: "参数管理", onClick: vi.fn() },
          { label: "项目参数工作台" }
        ]}
        eyebrow="AUR-Prod"
        title="项目参数工作台"
        description="当前项目 Aurora 量产平台"
        status={<span>已暂存 2 项</span>}
        primaryAction={<button type="button">提交本轮</button>}
        secondaryActions={[
          <button type="button" key="history">
            历史提交
          </button>,
          <button type="button" key="compare">
            跨项目对比
          </button>
        ]}
      />
    );

    const header = screen.getByRole("banner", { name: "参数工作区上下文" });

    expect(within(header).getByRole("navigation", { name: "工作区路径" })).toBeInTheDocument();
    expect(within(header).getByText("AUR-Prod")).toBeInTheDocument();
    expect(header.querySelector(".workspace-header__title")).toHaveTextContent("项目参数工作台");
    expect(within(header).getByText("当前项目 Aurora 量产平台")).toBeInTheDocument();
    expect(within(header).getByText("已暂存 2 项")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "提交本轮" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "历史提交" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "跨项目对比" })).toBeInTheDocument();
    expect(within(header).queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});
