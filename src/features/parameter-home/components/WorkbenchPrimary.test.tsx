import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchPrimary } from "./WorkbenchPrimary";
import type { PersonalWorkbenchViewModel } from "../workbench/derivePersonalWorkbench";

const baseWorkbench: PersonalWorkbenchViewModel = {
  roleView: "committer",
  emphasis: "action-first",
  nextActions: [
    {
      id: "committer-review-queue",
      kind: "todo",
      priority: "primary",
      title: "处理待审阅参数变更",
      description: "优先处理审阅节点。",
      meta: "4 项待审阅",
      path: "/parameter-review",
      source: "review"
    }
  ],
  scenarioEntries: [
    {
      id: "review",
      title: "处理审阅",
      description: "进入审阅队列。",
      path: "/parameter-review",
      pageKey: "parameter-review",
      metricLabel: "待审",
      metricValue: "4"
    },
    {
      id: "library",
      title: "查看参数库",
      description: "回到参数目录。",
      path: "/parameters",
      pageKey: "parameters",
      metricLabel: "参数",
      metricValue: "12"
    }
  ]
};

describe("WorkbenchPrimary", () => {
  it("renders action queue and permission-filtered entries", () => {
    render(<WorkbenchPrimary workbench={baseWorkbench} onNavigate={vi.fn()} />);
    expect(screen.getByRole("region", { name: "待办事项" })).toBeInTheDocument();
    expect(screen.getByText("处理待审阅参数变更")).toBeInTheDocument();
    expect(screen.getByText("处理审阅")).toBeInTheDocument();
  });

  it("fires navigation callbacks with context paths", () => {
    const onNavigate = vi.fn();
    render(<WorkbenchPrimary workbench={baseWorkbench} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /处理待审阅参数变更/ }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-review");
    fireEvent.click(screen.getByRole("button", { name: /打开 查看参数库/ }));
    expect(onNavigate).toHaveBeenCalledWith("/parameters");
  });
});
